import { WsRpcClient } from "@craft-agent/server-core/transport";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { buildClientApi } from "../../../electron/src/transport/build-api";
import { CHANNEL_MAP } from "../../../electron/src/transport/channel-map";
import type { ElectronAPI } from "../../../electron/src/shared/types";

type State =
  | { phase: "loading" }
  | { phase: "login"; error?: string }
  | { phase: "error"; message: string }
  | { phase: "ready"; api: ElectronAPI };

const Context = createContext<{ api: ElectronAPI } | null>(null);
const Login = createContext<(password: string) => Promise<void>>(
  async () => {},
);
export const useApi = () => {
  const value = useContext(Context);
  if (!value) throw new Error("Not connected");
  return value.api;
};
export const useLogin = () => useContext(Login);
export const useRpcState = () => useContext(StateContext);
const StateContext = createContext<State>({ phase: "loading" });

/** The headless server owns login (a cookie), the config and the WebSocket. */
export function RpcProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const client = useRef<WsRpcClient | null>(null);
  const started = useRef(false);

  const connect = useCallback(async () => {
    try {
      const config = await fetch("/api/config", { credentials: "same-origin" });
      if (config.status === 401) return setState({ phase: "login" });
      if (!config.ok) throw new Error(`Server answered ${config.status}`);
      const { wsUrl } = (await config.json()) as { wsUrl: string };
      let workspaceId: string | undefined;
      const workspaces = await fetch("/api/config/workspaces", {
        credentials: "same-origin",
      }).catch(() => null);
      if (workspaces?.ok)
        workspaceId = (
          (await workspaces.json()) as { defaultWorkspaceId?: string }
        ).defaultWorkspaceId;
      client.current?.destroy();
      const rpc = new WsRpcClient(wsUrl, {
        workspaceId,
        autoReconnect: true,
        mode: "remote",
      });
      client.current = rpc;
      const api = buildClientApi(rpc, CHANNEL_MAP, (channel) =>
        rpc.isChannelAvailable(channel),
      );
      rpc.connect();
      setState({ phase: "ready", api });
    } catch (error) {
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void connect();
    return () => client.current?.destroy();
  }, [connect]);

  const login = useCallback(
    async (password: string) => {
      const response = await fetch("/api/auth", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setState({
          phase: "login",
          error:
            response.status === 429
              ? "Too many attempts, try again later"
              : "Wrong password",
        });
        return;
      }
      setState({ phase: "loading" });
      await connect();
    },
    [connect],
  );

  return (
    <StateContext.Provider value={state}>
      <Login.Provider value={login}>
        {state.phase === "ready" ? (
          <Context.Provider value={{ api: state.api }}>
            {children}
          </Context.Provider>
        ) : (
          children
        )}
      </Login.Provider>
    </StateContext.Provider>
  );
}
