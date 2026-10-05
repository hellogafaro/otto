import {
  RiAddLine,
  RiClaudeFill,
  RiCpuLine,
  RiGithubFill,
  RiMoreLine,
  RiOpenaiFill,
} from "@remixicon/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { toast } from "@workspace/ui/components/sonner";
import { Spinner } from "@workspace/ui/components/spinner";
import { useEffect, useState } from "react";
import { Group, Row } from "@/components/settings";
import { IconAction } from "@/components/icon-action";
import { Page } from "@/components/page";
import { useApi } from "@/lib/rpc";

type Connection = Awaited<
  ReturnType<ReturnType<typeof useApi>["listLlmConnectionsWithStatus"]>
>[number];

function providerIcon(connection: Connection) {
  const key = `${connection.piAuthProvider ?? ""} ${connection.slug}`;
  if (/claude|anthropic/i.test(key) || connection.providerType === "anthropic")
    return RiClaudeFill;
  if (/openai|chatgpt|codex/i.test(key)) return RiOpenaiFill;
  if (/copilot|github/i.test(key)) return RiGithubFill;
  return RiCpuLine;
}

export function ModelsPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Connection | null>(null);
  const connections = useQuery({
    queryKey: ["llm-connections"],
    queryFn: () => api.listLlmConnectionsWithStatus(),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["llm-connections"] });
  useEffect(() => api.onLlmConnectionsChanged(() => void refresh()), [api]);
  const items = connections.data ?? [];

  return (
    <Page
      title="Models"
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Add connection" />
            }
          >
            <RiAddLine />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setAdding(true)}>
                <RiClaudeFill />
                Claude Pro / Max
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <RiOpenaiFill />
                Codex · ChatGPT Plus
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <RiGithubFill />
                GitHub Copilot
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <Group
        title="Connections"
        description="An agent runs on one connection and one of its models"
      >
        <Row
          title={
            connections.isPending
              ? "Loading"
              : items.length === 1
                ? "1 connection"
                : items.length
                  ? `${items.length} connections`
                  : "No connections"
          }
        />
        {items.map((connection) => {
          const Icon = providerIcon(connection);
          return (
            <Row
              key={connection.slug}
              title={connection.name}
              description={[
                connection.isAuthenticated ? "Connected" : "Sign-in needed",
                connection.isDefault && "Default",
              ]
                .filter(Boolean)
                .join(" · ")}
              media={<Icon className="size-4" />}
            >
              {!connection.isAuthenticated && (
                <Badge variant="outline">Reconnect needed</Badge>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Actions for ${connection.name}`}
                    />
                  }
                >
                  <RiMoreLine />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      disabled={connection.isDefault}
                      onClick={async () => {
                        const result = await api.setDefaultLlmConnection(
                          connection.slug,
                        );
                        if (!result.success)
                          toast.error(result.error ?? "Unable to set default");
                        void refresh();
                      }}
                    >
                      Make default
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setRemoving(connection)}
                    >
                      Disconnect
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </Row>
          );
        })}
      </Group>

      <AddClaude
        open={adding}
        onOpenChange={setAdding}
        existing={items.map((item) => item.slug)}
        onAdded={refresh}
      />
      <AlertDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its stored sign-in is removed. Agents that use it can't run until
              you pick another connection.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!removing) return;
                const result = await api.deleteLlmConnection(removing.slug);
                if (result.success) toast.success(`${removing.name} disconnected`);
                else toast.error(result.error ?? "Unable to disconnect");
                setRemoving(null);
                void refresh();
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

// Claude sign-in works from any browser: open the link, sign in, paste the code.
function AddClaude({
  open,
  onOpenChange,
  existing,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: string[];
  onAdded: () => void;
}) {
  const api = useApi();
  const [authUrl, setAuthUrl] = useState<string>();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  // Opening the dialog starts the sign-in and gives the link.
  useEffect(() => {
    if (!open) return;
    setCode("");
    setError(undefined);
    setAuthUrl(undefined);
    void api.startClaudeOAuth().then((result) => {
      if (result.success && result.authUrl) setAuthUrl(result.authUrl);
      else setError(result.error ?? "Unable to start sign-in");
    });
    return () => void api.clearClaudeOAuthState();
  }, [open, api]);

  const submit = async () => {
    setPending(true);
    setError(undefined);
    let slug = "claude-max";
    for (let n = 2; existing.includes(slug); n++) slug = `claude-max-${n}`;
    try {
      const exchanged = await api.exchangeClaudeCode(code.trim(), slug);
      if (!exchanged.success || !exchanged.token)
        throw new Error(exchanged.error ?? "That code didn't work");
      const saved = await api.setupLlmConnection({
        slug,
        credential: exchanged.token,
        oauthIdentity: exchanged.identity,
      });
      if (!saved.success) throw new Error(saved.error ?? "Unable to save");
      toast.success("Claude connected");
      onAdded();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect Claude</DialogTitle>
          <DialogDescription>
            Sign in with your Claude Pro or Max account in any browser, then
            paste the code it shows.
          </DialogDescription>
        </DialogHeader>
        <Field data-invalid={Boolean(error) || undefined}>
          <FieldLabel htmlFor="claude-code">Code</FieldLabel>
          <Input
            id="claude-code"
            value={code}
            disabled={!authUrl}
            aria-invalid={Boolean(error)}
            onChange={(event) => setCode(event.target.value)}
          />
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={!authUrl}
            onClick={() => authUrl && window.open(authUrl, "_blank", "noopener")}
          >
            Open sign-in
          </Button>
          <Button disabled={!code.trim() || pending} onClick={submit}>
            {pending && <Spinner />}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { IconAction };
