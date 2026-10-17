import { useState } from "react";

import { useI18n } from "../../i18n";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Field, FieldLabel } from "../ui/field";
import { Form } from "../ui/form";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import {
  AuthActions,
  AuthSecondaryButton,
  AuthSurfaceSection,
  AuthSurfaceShell,
} from "./auth-surface-shell";

/** Otto: the desktop window shows the web app of the Otto server it is connected to. */
export function DesktopServerPage({ onBack }: { readonly onBack: () => void }) {
  const { t } = useI18n();
  const [currentServer] = useState(() => window.desktopBridge?.getServerUrl?.() ?? null);
  const [address, setAddress] = useState(currentServer ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const connect = async (server: string | null) => {
    setPending(true);
    setError(null);

    try {
      await window.desktopBridge?.setServerUrl?.(server);
      onBack();
    } catch {
      setError(t("No Otto server answered at that address."));
      setPending(false);
    }
  };

  return (
    <AuthSurfaceShell>
      <AuthSurfaceSection className="gap-2">
        <h1 className="text-xl leading-title font-medium">{t("Connect to a server")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Enter the address of an Otto server. This window opens its app.")}
        </p>
      </AuthSurfaceSection>
      <AuthSurfaceSection>
        {error ? (
          <Alert variant="error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Form
          noValidate
          spacing="compact"
          onSubmit={(event) => {
            event.preventDefault();
            const value = address.trim();

            if (!pending && value)
              void connect(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
          }}
        >
          <Field>
            <FieldLabel className="sr-only" htmlFor="auth-server">
              {t("Server address")}
            </FieldLabel>
            <Input
              nativeInput
              autoFocus
              id="auth-server"
              type="url"
              placeholder="https://otto.example.com"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              disabled={pending}
            />
          </Field>
          <AuthActions>
            <Button type="submit" variant="primary" disabled={pending || !address.trim()}>
              {pending ? <Spinner /> : null}
              {t("Connect")}
            </Button>
            {currentServer ? (
              <AuthSecondaryButton disabled={pending} onClick={() => void connect(null)}>
                {t("Use this computer")}
              </AuthSecondaryButton>
            ) : null}
            <AuthSecondaryButton disabled={pending} onClick={onBack}>
              {t("Back")}
            </AuthSecondaryButton>
          </AuthActions>
        </Form>
      </AuthSurfaceSection>
    </AuthSurfaceShell>
  );
}
