import { Button } from "@workspace/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { useState } from "react";
import { authClient } from "@/lib/auth";

export function Authentication() {
  const token = new URLSearchParams(window.location.search).get("token");
  const [mode, setMode] = useState<"signin" | "signup" | "request" | "reset">(
    token ? "reset" : "signin",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const heading =
    mode === "signup"
      ? "Create your Otto account"
      : mode === "request"
        ? "Reset your password"
        : mode === "reset"
          ? "Choose a new password"
          : "Sign in to Otto";
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-5 p-5">
      <h1>{heading}</h1>
      <form
        className="w-full max-w-sm"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setPending(true);
          setError(undefined);
          setMessage(undefined);
          try {
            const result =
              mode === "signup"
                ? await authClient.signUp.email({
                    name: String(form.get("name")),
                    email: String(form.get("email")),
                    password: String(form.get("password")),
                  })
                : mode === "request"
                  ? await authClient.requestPasswordReset({
                      email: String(form.get("email")),
                      redirectTo: new URL("/", window.location.origin).href,
                    })
                  : mode === "reset"
                    ? await authClient.resetPassword({
                        newPassword: String(form.get("password")),
                        token: token ?? "",
                      })
                    : await authClient.signIn.email({
                        email: String(form.get("email")),
                        password: String(form.get("password")),
                      });
            if (result.error)
              setError(
                result.error.message ?? "Unable to complete this request.",
              );
            else if (mode === "signup")
              setMessage(
                "Account created. Check your email if verification is required; workspace access is granted separately.",
              );
            else if (mode === "request")
              setMessage(
                "If this account can reset its password, instructions will arrive by email.",
              );
            else if (mode === "reset") {
              setMessage("Password changed. Sign in with your new password.");
              setMode("signin");
              history.replaceState(null, "", window.location.pathname);
            }
          } catch {
            setError("Unable to reach Otto. Try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        <FieldGroup>
          {mode === "signup" && (
            <Field>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                required
                disabled={pending}
                maxLength={200}
              />
            </Field>
          )}
          {mode !== "reset" && (
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                disabled={pending}
                maxLength={254}
              />
            </Field>
          )}
          {mode !== "request" && (
            <Field>
              <FieldLabel htmlFor="password">
                {mode === "reset" ? "New password" : "Password"}
              </FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={
                  mode === "signup" || mode === "reset"
                    ? "new-password"
                    : "current-password"
                }
                minLength={mode === "signin" ? undefined : 12}
                required
                disabled={pending}
              />
            </Field>
          )}
          {error && <p role="alert">{error}</p>}
          {message && <p role="status">{message}</p>}
          <Button type="submit" disabled={pending}>
            {pending
              ? "Please wait"
              : mode === "signup"
                ? "Create account"
                : mode === "request"
                  ? "Send reset instructions"
                  : mode === "reset"
                    ? "Change password"
                    : "Sign in"}
          </Button>
          <div className="flex flex-wrap gap-2">
            {mode !== "signin" && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setMode("signin");
                  setError(undefined);
                }}
              >
                Sign in
              </Button>
            )}
            {mode === "signin" && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setMode("signup");
                    setError(undefined);
                  }}
                >
                  Create account
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setMode("request");
                    setError(undefined);
                  }}
                >
                  Forgot password
                </Button>
              </>
            )}
          </div>
        </FieldGroup>
      </form>
    </main>
  );
}
