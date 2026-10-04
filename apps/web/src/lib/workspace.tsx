import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { createContext, type ReactNode, useContext, useState } from "react";
import { client, read, workspaceApi } from "@/lib/api";
import { authClient } from "@/lib/auth";

type Workspace =
  Awaited<ReturnType<typeof client.workspaces.$get>> extends {
    json(): Promise<infer T>;
  }
    ? T extends { items: (infer W)[] }
      ? W
      : never
    : never;
interface WorkspaceContext {
  workspaceId: string;
  workspace: Workspace;
  workspaces: Workspace[];
  user: { id: string; name: string; email: string };
  api: typeof workspaceApi;
  selectWorkspace(id: string): void;
  invalidate(): Promise<void>;
}
const context = createContext<WorkspaceContext | null>(null);

export function useWorkspace() {
  const value = useContext(context);
  if (!value) throw new Error("Workspace boundary is missing");
  return value;
}

export function WorkspaceBoundary({ children }: { children: ReactNode }) {
  const session = authClient.useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState(() =>
    localStorage.getItem("otto-workspace"),
  );
  const workspaces = useQuery({
    queryKey: ["workspaces", session.data?.user.id],
    queryFn: async () =>
      read(
        await client.workspaces.$get({
          query: { limit: "100", sort: "title" },
        }),
      ),
    enabled: Boolean(session.data),
    retry: false,
  });
  if (session.isPending)
    return <BoundaryMessage>Loading your session</BoundaryMessage>;
  if (session.error)
    return (
      <BoundaryMessage>
        <p>Unable to load your session.</p>
        <Button onClick={() => session.refetch()}>Retry</Button>
      </BoundaryMessage>
    );
  if (!session.data) return <SignIn />;
  if (workspaces.isPending)
    return <BoundaryMessage>Loading workspaces</BoundaryMessage>;
  if (workspaces.error)
    return (
      <BoundaryMessage>
        <p>{workspaces.error.message}</p>
        <Button onClick={() => workspaces.refetch()}>Retry</Button>
      </BoundaryMessage>
    );
  const list = workspaces.data.items;
  const workspace = list.find((item) => item.id === selectedId) ?? list[0];
  if (!workspace)
    return (
      <BoundaryMessage>
        <p>No workspace access. Ask an owner for an invitation.</p>
        <p>Installation setup is performed by the server administrator.</p>
        <Button onClick={() => workspaces.refetch()}>Check again</Button>
        <Button variant="ghost" onClick={() => authClient.signOut()}>
          Log out
        </Button>
      </BoundaryMessage>
    );
  return (
    <context.Provider
      key={`${session.data.user.id}:${workspace.id}`}
      value={{
        workspaceId: workspace.id,
        workspace,
        workspaces: list,
        user: session.data.user,
        api: workspaceApi,
        selectWorkspace: (id) => {
          // Cancel and discard the old workspace before navigating: cached private bytes never cross scopes.
          void queryClient.cancelQueries({
            queryKey: ["workspace", workspace.id],
          });
          queryClient.removeQueries({ queryKey: ["workspace", workspace.id] });
          localStorage.setItem("otto-workspace", id);
          setSelectedId(id);
          void navigate({ to: "/" });
        },
        invalidate: () =>
          queryClient.invalidateQueries({
            queryKey: ["workspace", workspace.id],
          }),
      }}
    >
      {children}
    </context.Provider>
  );
}

function BoundaryMessage({ children }: { children: ReactNode }) {
  return (
    <main
      className="flex min-h-svh flex-col items-center justify-center gap-3 p-5"
      role="status"
    >
      {children}
    </main>
  );
}

function SignIn() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <BoundaryMessage>
      <h1>Sign in to Otto</h1>
      <form
        className="w-full max-w-sm"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setPending(true);
          setError(undefined);
          try {
            const result = await authClient.signIn.email({
              email: String(form.get("email")),
              password: String(form.get("password")),
            });
            if (result.error)
              setError(result.error.message ?? "Sign in failed.");
          } catch {
            setError("Unable to reach Otto. Try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              disabled={pending}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={pending}
            />
          </Field>
          {error && <p role="alert">{error}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Signing in" : "Sign in"}
          </Button>
        </FieldGroup>
      </form>
    </BoundaryMessage>
  );
}
