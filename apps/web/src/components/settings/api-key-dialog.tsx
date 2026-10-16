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
import { Field, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

export interface CredentialField {
  readonly name: string;
  readonly label: string;
  readonly secret: boolean;
  /** A secret already stored on the server; leaving the input empty keeps it. */
  readonly saved?: boolean;
  readonly value?: string;
}

/**
 * Otto: The one credentials dialog for provider rows (voice providers, sandboxes). One field
 * shows a bare input labelled by its placeholder; several fields get visible labels. Password
 * managers are told to stay out: these are API keys, not account passwords.
 */
export function CredentialsDialog({
  title,
  description,
  fields,
  submitLabel,
  onSave,
  onClose,
}: {
  readonly title: string;
  readonly description: string;
  readonly fields: ReadonlyArray<CredentialField>;
  readonly submitLabel: string;
  readonly onSave: (values: Readonly<Record<string, string>>) => Promise<boolean>;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();

  const [values, setValues] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, field.value ?? ""])),
  );

  const [saving, setSaving] = useState(false);

  const complete = fields.every(
    (field) => (values[field.name] ?? "").trim().length > 0 || (field.secret && field.saved),
  );

  const save = async () => {
    if (!complete || saving) return;

    setSaving(true);

    const saved = await onSave(
      Object.fromEntries(fields.map((field) => [field.name, (values[field.name] ?? "").trim()])),
    );

    setSaving(false);

    if (saved) onClose();
  };

  const input = (field: CredentialField, index: number) => (
    <Input
      autoFocus={index === 0}
      type={field.secret ? "password" : "text"}
      autoComplete="off"
      data-1p-ignore=""
      data-lpignore="true"
      data-bwignore=""
      data-form-type="other"
      spellCheck={false}
      aria-label={field.label}
      placeholder={field.saved ? "••••••••••••" : field.label}
      value={values[field.name] ?? ""}
      onChange={(event) => {
        const value = event.currentTarget.value;

        setValues((current) => ({ ...current, [field.name]: value }));
      }}
    />
  );

  return (
    <Dialog open onOpenChange={(open) => (open || saving ? undefined : onClose())}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogPanel className="flex flex-col gap-4">
            {fields.length === 1
              ? input(fields[0]!, 0)
              : fields.map((field, index) => (
                  <Field key={field.name}>
                    <FieldLabel>{field.label}</FieldLabel>
                    {input(field, index)}
                  </Field>
                ))}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={!complete || saving}>
              {saving ? <Spinner /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** Otto: A single API key, as voice providers ask for it: Save key, or Replace key over a saved one. */
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

  return (
    <CredentialsDialog
      title={replacing ? t("Replace {name} key", { name }) : t("Connect {name}", { name })}
      description={t("The key stays on this environment. {name} bills its API usage.", { name })}
      fields={[{ name: "apiKey", label: keyLabel, secret: true }]}
      submitLabel={replacing ? t("Replace key") : t("Save key")}
      onSave={(values) => onSave(values.apiKey ?? "")}
      onClose={onClose}
    />
  );
}
