import { squashAtomCommandFailure } from "@otto/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type ProjectId,
  type ProjectSecret,
  SecretName,
} from "@otto/contracts";
import {
  RiAddLine,
  RiDeleteBinLine,
  RiEyeLine,
  RiEyeOffLine,
  RiFileCopyLine,
  RiKey2Line,
  RiMoreLine,
  RiPencilLine,
} from "@remixicon/react";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { writeTextToClipboard } from "~/hooks/use-copy-to-clipboard";
import { useI18n } from "../../i18n";
import { ensureLocalApi } from "../../local-api";
import { useEnvironmentQuery } from "../../state/query";
import { secretsEnvironment } from "../../state/secrets";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Empty, EmptyDescription, EmptyMedia } from "../ui/empty";
import { Input } from "../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const isSecretName = Schema.is(SecretName);

const updatedAtFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const failureDetail = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
  const cause = squashAtomCommandFailure(result);

  return cause instanceof Error ? { description: cause.message } : undefined;
};

/** The top-bar button that adds a secret, a quiet 28px icon like the other project tabs'. */
export function ProjectAddSecret({ onAdd }: { readonly onAdd: () => void }) {
  const { t } = useI18n();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button size="icon-sm" variant="ghost-muted" aria-label={t("Add secret")} onClick={onAdd}>
            <RiAddLine aria-hidden className="size-4" />
          </Button>
        }
      />
      <TooltipPopup side="bottom">{t("Add secret")}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Otto: A project's Secrets tab. Every chat in the project gets these as environment variables
 * in its commands. Values stay on the server until someone reveals or copies one.
 */
export function ProjectSecrets({
  environmentId,
  projectId,
  adding,
  onAddingChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly adding: boolean;
  readonly onAddingChange: (adding: boolean) => void;
}) {
  const { t } = useI18n();
  const removeSecret = useAtomCommand(secretsEnvironment.remove, { reportFailure: false });
  const [editing, setEditing] = useState<string | null>(null);

  const list = useEnvironmentQuery(
    secretsEnvironment.list({ environmentId, input: { projectId } }),
  );

  const secrets = list.data?.secrets ?? null;

  const remove = async (name: string) => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      t("Delete {name}? Chats in this project stop getting it.", { name }),
      { variant: "destructive" },
    );

    if (!confirmed) return;
    const result = await removeSecret({ environmentId, input: { projectId, name } });

    if (Predicate.isTagged(result, "Failure")) {
      toast.error(t("{name} couldn't be deleted", { name }), failureDetail(result));
    }

    list.refresh();
  };

  const dialog = (
    <SecretDialog
      environmentId={environmentId}
      projectId={projectId}
      name={editing}
      open={adding || editing !== null}
      onOpenChange={(open) => {
        if (open) return;
        onAddingChange(false);
        setEditing(null);
      }}
      onSaved={list.refresh}
    />
  );

  if (list.error !== null) {
    return (
      <>
        <Empty>
          <EmptyMedia variant="icon">
            <RiKey2Line />
          </EmptyMedia>
          <EmptyDescription>{t("Secrets couldn't be loaded")}</EmptyDescription>
        </Empty>
        {dialog}
      </>
    );
  }

  if (secrets === null) return dialog;

  if (secrets.length === 0) {
    return (
      <>
        <Empty>
          <EmptyMedia variant="icon">
            <RiKey2Line />
          </EmptyMedia>
          <EmptyDescription>
            {t("No secrets yet. Every chat in this project gets them as environment variables.")}
          </EmptyDescription>
        </Empty>
        {dialog}
      </>
    );
  }

  return (
    <>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {secrets.map((secret) => (
          <SecretRow
            key={`${secret.name}:${secret.updatedAt}`}
            environmentId={environmentId}
            projectId={projectId}
            secret={secret}
            onEdit={() => setEditing(secret.name)}
            onRemove={() => void remove(secret.name)}
          />
        ))}
      </ul>
      {dialog}
    </>
  );
}

function SecretRow({
  environmentId,
  projectId,
  secret,
  onEdit,
  onRemove,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly secret: ProjectSecret;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}) {
  const { t } = useI18n();
  const revealSecret = useAtomCommand(secretsEnvironment.reveal, { reportFailure: false });
  const [value, setValue] = useState<string | null>(null);

  const read = async () => {
    const result = await revealSecret({ environmentId, input: { projectId, name: secret.name } });

    if (Predicate.isTagged(result, "Failure")) {
      toast.error(t("{name} couldn't be read", { name: secret.name }), failureDetail(result));

      return null;
    }

    return result.value.value;
  };

  const copy = async () => {
    const current = value ?? (await read());

    if (current === null) return;
    await writeTextToClipboard(current, "secret");
    toast.success(t("Copied {name}", { name: secret.name }));
  };

  const revealLabel = value === null ? t("Reveal") : t("Hide");

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <div className="w-52 min-w-0 shrink-0">
        <p className="truncate font-mono text-sm">{secret.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {t("Updated {date}", { date: updatedAtFormatter.format(new Date(secret.updatedAt)) })}
        </p>
      </div>
      <InputGroup className="flex-1">
        <InputGroupInput
          readOnly
          size="sm"
          type={value === null ? "password" : "text"}
          aria-label={t("Value of {name}", { name: secret.name })}
          variant="mono"
          value={value ?? "••••••••••••••••"}
          onFocus={(event) => event.currentTarget.select()}
        />
        <InputGroupAddon align="inline-end">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={revealLabel}
                  onClick={() => void (value === null ? read().then(setValue) : setValue(null))}
                >
                  {value === null ? <RiEyeLine aria-hidden /> : <RiEyeOffLine aria-hidden />}
                </Button>
              }
            />
            <TooltipPopup side="bottom">{revealLabel}</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t("Copy value")}
                  onClick={() => void copy()}
                >
                  <RiFileCopyLine aria-hidden />
                </Button>
              }
            />
            <TooltipPopup side="bottom">{t("Copy value")}</TooltipPopup>
          </Tooltip>
        </InputGroupAddon>
      </InputGroup>
      <Menu>
        <MenuTrigger
          render={
            <Button size="icon-sm" variant="ghost-muted" aria-label={t("More actions")}>
              <RiMoreLine aria-hidden className="size-4" />
            </Button>
          }
        />
        <MenuPopup align="end">
          <MenuItem onClick={onEdit}>
            <RiPencilLine aria-hidden />
            {t("Replace value")}
          </MenuItem>
          <MenuItem variant="destructive" onClick={onRemove}>
            <RiDeleteBinLine aria-hidden />
            {t("Delete")}
          </MenuItem>
        </MenuPopup>
      </Menu>
    </li>
  );
}

/** Adds a secret, or replaces one's value when `name` is set. */
function SecretDialog({
  environmentId,
  projectId,
  name,
  open,
  onOpenChange,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly name: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: () => void;
}) {
  const { t } = useI18n();
  const saveSecrets = useAtomCommand(secretsEnvironment.save, { reportFailure: false });
  const [draftName, setDraftName] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const secretName = name ?? draftName.trim();
  const valid = isSecretName(secretName) && value.length > 0;

  useEffect(() => {
    if (open) return;
    setDraftName("");
    setValue("");
  }, [open]);

  const save = async () => {
    if (!valid) return;
    setSaving(true);

    const result = await saveSecrets({
      environmentId,
      input: { target: { scope: "project", projectId }, values: { [secretName]: value } },
    });

    setSaving(false);

    if (Predicate.isTagged(result, "Failure")) {
      toast.error(t("{name} couldn't be saved", { name: secretName }), failureDetail(result));

      return;
    }

    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md" bottomStickOnMobile={false}>
        <DialogHeader>
          <DialogTitle>{name ? t("Replace {name}", { name }) : t("Add secret")}</DialogTitle>
          <DialogDescription>
            {t("Every chat in this project gets it as an environment variable in its commands.")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-3">
          {name ? null : (
            <Input
              aria-label={t("Name")}
              placeholder="API_KEY"
              variant="mono"
              autoFocus
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
            />
          )}
          <Textarea
            aria-label={t("Value")}
            placeholder={t("Value")}
            autoFocus={name !== null}
            spellCheck={false}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button disabled={!valid || saving} onClick={() => void save()}>
            {saving ? <Spinner /> : null}
            {t("Save")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
