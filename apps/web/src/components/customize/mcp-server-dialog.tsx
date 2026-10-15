import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@otto/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type McpServer,
  McpServerId,
  type McpServerVisibility,
} from "@otto/contracts";
import { RiAddLine, RiDeleteBinLine } from "@remixicon/react";
import { Predicate } from "effect";
import { useEffect, useId, useState } from "react";

import { useI18n } from "../../i18n";
import { randomUUID } from "../../lib/utils";
import { mcpServerEnvironment } from "../../state/mcp-servers";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Field, FieldError, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { toastManager } from "../ui/toast";
import { Spinner } from "../ui/spinner";

interface Draft {
  readonly name: string;
  readonly url: string;
}

/** One header row. A saved header has no value until it is replaced; its value stays on the server. */
interface HeaderDraft {
  readonly key: string;
  readonly name: string;
  readonly value: string;
  readonly saved: boolean;
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** HTTPS only for now: a server on someone's machine can't be reached by every bot. */
function draftError(draft: Draft, t: ReturnType<typeof useI18n>["t"]): string | null {
  if (!draft.name.trim()) return t("Name is required.");

  try {
    const url = new URL(draft.url.trim());

    if (url.protocol !== "https:") return t("Use an https:// address.");

    return url.username || url.password ? t("Keep credentials out of the address.") : null;
  } catch {
    return t("Enter the server's https:// address.");
  }
}

function headersError(headers: readonly HeaderDraft[], t: ReturnType<typeof useI18n>["t"]) {
  const names = new Set<string>();

  for (const header of headers) {
    const name = header.name.trim();

    if (!HEADER_NAME.test(name)) return t("Use a header name like Authorization.");

    if (names.has(name.toLowerCase())) return t("Each header name can be used once.");
    names.add(name.toLowerCase());

    if (!header.saved && header.value.trim() === "")
      return t("Enter a value for {name}.", { name });
  }

  return null;
}

export function useMcpCommands() {
  const { t } = useI18n();

  const commands = {
    create: useAtomCommand(mcpServerEnvironment.create, { reportFailure: false }),
    update: useAtomCommand(mcpServerEnvironment.update, { reportFailure: false }),
    remove: useAtomCommand(mcpServerEnvironment.delete, { reportFailure: false }),
    enable: useAtomCommand(mcpServerEnvironment.enable, { reportFailure: false }),
    disable: useAtomCommand(mcpServerEnvironment.disable, { reportFailure: false }),
    setAccess: useAtomCommand(mcpServerEnvironment.setAccess, { reportFailure: false }),
    setHeaders: useAtomCommand(serverEnvironment.setMcpServerHeaders, { reportFailure: false }),
  };

  /** Toasts a failed command and says whether it failed. */
  const failed = (title: string, result: AtomCommandResult<unknown, unknown>): boolean => {
    if (!Predicate.isTagged(result, "Failure")) return false;

    if (isAtomCommandInterrupted(result)) return true;
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title,
      description: error instanceof Error ? error.message : t("The command failed."),
    });

    return true;
  };

  return { ...commands, failed };
}

/**
 * The add and edit dialog: a name, the https address and any request headers, like an API
 * key. Header values are written once and never shown again. A new server joins the group
 * it was added from.
 */
export function McpServerDialog({
  environmentId,
  server,
  visibility = "user",
  open,
  onOpenChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly server: McpServer | null;
  readonly visibility?: McpServerVisibility;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const commands = useMcpCommands();

  const [draft, setDraft] = useState<Draft>({
    name: server?.name ?? "",
    url: server?.transport === "url" ? server.url : "",
  });

  const savedHeaders = useEnvironmentQuery(
    server
      ? serverEnvironment.mcpServerHeaders({ environmentId, input: { mcpServerId: server.id } })
      : null,
  );

  const savedNames = savedHeaders.data?.names;
  const [headers, setHeaders] = useState<readonly HeaderDraft[] | null>(server ? null : []);

  useEffect(() => {
    if (headers === null && savedNames) {
      setHeaders(savedNames.map((name) => ({ key: name, name, value: "", saved: true })));
    }
  }, [headers, savedNames]);

  const headersLabelId = useId();
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const error = draftError(draft, t);
  const headerError = headers ? headersError(headers, t) : null;

  const headersChanged =
    headers !== null &&
    (headers.some((header) => !header.saved || header.value !== "") ||
      headers.map((header) => header.name).join("\n") !== (savedNames ?? []).join("\n"));

  const updateHeader = (key: string, change: Partial<HeaderDraft>) =>
    setHeaders((current) =>
      (current ?? []).map((header) => (header.key === key ? { ...header, ...change } : header)),
    );

  const save = async () => {
    setAttempted(true);

    if (error || headerError) return;
    setSaving(true);
    const mcpServerId = server?.id ?? McpServerId.make(randomUUID());

    const configuration = {
      name: draft.name.trim(),
      transport: "url" as const,
      url: draft.url.trim(),
    };

    const result = server
      ? await commands.update({
          environmentId,
          input: { mcpServerId: server.id, ...configuration },
        })
      : await commands.create({
          environmentId,
          input: { mcpServerId, ...configuration, visibility },
        });

    if (
      commands.failed(
        server ? t("Could not update MCP server") : t("Could not add MCP server"),
        result,
      )
    ) {
      setSaving(false);

      return;
    }

    if (headers && headersChanged) {
      const saved = await commands.setHeaders({
        environmentId,
        input: {
          mcpServerId,
          headers: headers.map((header) => ({
            name: header.name.trim(),
            value: header.value === "" ? null : header.value,
          })),
        },
      });

      if (commands.failed(t("Could not save the headers"), saved)) {
        setSaving(false);

        return;
      }

      savedHeaders.refresh();
    }

    setSaving(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{server ? t("Edit MCP server") : t("Add MCP server")}</DialogTitle>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogPanel className="flex flex-col gap-4">
            <Field>
              <FieldLabel>{t("Name")}</FieldLabel>
              <Input
                autoFocus
                value={draft.name}
                placeholder={t("Linear")}
                onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
              />
            </Field>
            <Field>
              <FieldLabel>{t("Address")}</FieldLabel>
              <Input
                value={draft.url}
                placeholder="https://mcp.example.com/mcp"
                spellCheck={false}
                onChange={(event) => setDraft({ ...draft, url: event.currentTarget.value })}
              />
              {attempted && error ? <FieldError match>{error}</FieldError> : null}
            </Field>
            <div
              role="group"
              aria-labelledby={headersLabelId}
              className="flex flex-col items-start gap-2"
            >
              <Label id={headersLabelId} render={<span />}>
                {t("Headers")}
              </Label>
              {(headers ?? []).map((header) => (
                <div key={header.key} className="flex w-full items-center gap-2">
                  <Input
                    aria-label={t("Header name")}
                    value={header.name}
                    placeholder="Authorization"
                    spellCheck={false}
                    disabled={header.saved}
                    onChange={(event) =>
                      updateHeader(header.key, { name: event.currentTarget.value })
                    }
                  />
                  <Input
                    aria-label={t("Header value")}
                    type="password"
                    autoComplete="off"
                    value={header.value}
                    placeholder={header.saved ? t("Saved") : t("Value")}
                    onChange={(event) =>
                      updateHeader(header.key, { value: event.currentTarget.value })
                    }
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost-muted"
                    aria-label={t("Remove header")}
                    onClick={() =>
                      setHeaders((current) =>
                        (current ?? []).filter((candidate) => candidate.key !== header.key),
                      )
                    }
                  >
                    <RiDeleteBinLine aria-hidden className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={headers === null}
                onClick={() =>
                  setHeaders((current) => [
                    ...(current ?? []),
                    { key: randomUUID(), name: "", value: "", saved: false },
                  ])
                }
              >
                <RiAddLine aria-hidden />
                {t("Add header")}
              </Button>
              {attempted && headerError ? (
                <p role="alert" className="text-destructive-foreground text-xs">
                  {headerError}
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner /> : null}
              {server ? t("Save") : t("Add server")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
