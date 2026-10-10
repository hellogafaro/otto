import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { Authentication } from "@/components/authentication";
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
  moreWorkspaces: boolean;
  loadingWorkspaces: boolean;
  loadWorkspaces(): Promise<unknown>;
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
  const sessionOwner = session.data
    ? `${session.data.user.id}:${session.data.session.id}`
    : null;
  const [cacheOwner, setCacheOwner] = useState<string | null>();
  // Block private rendering until every prior principal's request/cache is removed, including expiry and revocation.
  useEffect(() => {
    if (session.isPending || cacheOwner === sessionOwner) return;
    let obsolete = false;
    void queryClient.cancelQueries().then(() => {
      if (obsolete) return;
      queryClient.clear();
      setCacheOwner(sessionOwner);
    });
    return () => {
      obsolete = true;
    };
  }, [cacheOwner, sessionOwner, session.isPending, queryClient]);
  const [selectedId, setSelectedId] = useState(() =>
    localStorage.getItem("otto-workspace"),
  );
  const workspaces = useInfiniteQuery({
    queryKey: ["workspaces", session.data?.user.id],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await client.workspaces.$get({
          query: { limit: "100", sort: "title", after: pageParam },
        }),
      ),
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: Boolean(session.data) && cacheOwner === sessionOwner,
    retry: false,
  });
  const selectedMissing = Boolean(
    selectedId &&
      workspaces.data &&
      !workspaces.data.pages.some((page) =>
        page.items.some((item) => item.id === selectedId),
      ),
  );
  useEffect(() => {
    if (
      selectedMissing &&
      workspaces.hasNextPage &&
      !workspaces.isFetchingNextPage &&
      !workspaces.error
    )
      void workspaces.fetchNextPage();
  }, [selectedMissing, workspaces]);
  if (session.isPending || cacheOwner !== sessionOwner)
    return <BoundaryMessage>Loading your session</BoundaryMessage>;
  if (session.error)
    return (
      <BoundaryMessage>
        <p>Unable to load your session.</p>
        <Button onClick={() => session.refetch()}>Retry</Button>
      </BoundaryMessage>
    );
  if (!session.data) return <Authentication />;
  if (
    workspaces.isPending ||
    (selectedMissing && workspaces.hasNextPage && !workspaces.error)
  )
    return <BoundaryMessage>Loading workspaces</BoundaryMessage>;
  if (workspaces.error)
    return (
      <BoundaryMessage>
        <p>{workspaces.error.message}</p>
        <Button onClick={() => workspaces.refetch()}>Retry</Button>
      </BoundaryMessage>
    );
  const list = workspaces.data.pages.flatMap((page) => page.items);
  const workspace = list.find((item) => item.id === selectedId) ?? list[0];
  if (!workspace)
    return (
      <BoundaryMessage>
        <p>No workspace access. Ask an owner for an invitation.</p>
        <p>Installation setup is performed by the server administrator.</p>
        <InvitationJoin />
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
        moreWorkspaces: workspaces.hasNextPage,
        loadingWorkspaces: workspaces.isFetchingNextPage,
        loadWorkspaces: () => workspaces.fetchNextPage(),
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

function InvitationJoin() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <form
      className="w-full max-w-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const invitationId = String(form.get("invitationId")).trim();
        setPending(true);
        setError(undefined);
        try {
          await read(
            await client.invitations[":id"].accept.$post({
              param: { id: invitationId },
              json: { token: String(form.get("invitationToken")).trim() },
            }),
          );
          await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "Unable to join workspace.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="invitation-id">Invitation ID</FieldLabel>
          <Input
            id="invitation-id"
            name="invitationId"
            required
            disabled={pending}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="invitation-token">Invitation token</FieldLabel>
          <Input
            id="invitation-token"
            name="invitationToken"
            type="password"
            autoComplete="off"
            maxLength={4096}
            required
            disabled={pending}
          />
        </Field>
        {error && <p role="alert">{error}</p>}
        <Button disabled={pending} type="submit">
          {pending ? "Joining" : "Accept invitation"}
        </Button>
      </FieldGroup>
    </form>
  );
}
