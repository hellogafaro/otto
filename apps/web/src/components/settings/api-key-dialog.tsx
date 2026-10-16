import { useState } from "react";

import { useI18n } from "../../i18n";
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
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

/**
 * Otto: The one API key dialog for provider rows (voice providers, Browserbase): a password
 * input, ghost Cancel and Save key, or Replace key when a key is already saved.
 */
export function ApiKeyDialog({
  name,
  keyLabel,
  replacing,
  onSave,
  onClose,
}: {
  readonly name: string;
  readonly keyLabel: string;
  readonly replacing: boolean;
  readonly onSave: (apiKey: string) => Promise<boolean>;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const trimmed = apiKey.trim();

    if (!trimmed) return;

    setSaving(true);

    const saved = await onSave(trimmed);

    setSaving(false);

    if (saved) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {replacing ? t("Replace {name} key", { name }) : t("Connect {name}", { name })}
          </DialogTitle>
          <DialogDescription>
            {t("The key stays on this environment. {name} bills its API usage.", { name })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogPanel>
            <Input
              autoFocus
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label={keyLabel}
              placeholder={keyLabel}
              value={apiKey}
              onChange={(event) => setApiKey(event.currentTarget.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={!apiKey.trim() || saving}>
              {saving ? <Spinner /> : null}
              {replacing ? t("Replace key") : t("Save key")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
