import { RiEyeLine, RiEyeOffLine } from "@remixicon/react";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group";
import { useState } from "react";
import { authClient } from "@/lib/auth";
import "./authentication.css";

export function Authentication() {
  const token = new URLSearchParams(window.location.search).get("token");
  const [mode, setMode] = useState<"signin" | "signup" | "request" | "reset">(
    token ? "reset" : "signin",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [passwordShown, setPasswordShown] = useState(false);
  const heading =
    mode === "signup"
      ? "Create your Otto account"
      : mode === "request"
        ? "Reset your password"
        : mode === "reset"
          ? "Choose a new password"
          : "Sign in to Otto";
  return (
    <main className="authentication">
      <div className="authentication-column">
        <header>
          <img
            className="authentication-icon"
            src="/authentication-otto-icon.png"
            alt=""
            aria-hidden="true"
            width={40}
            height={40}
          />
          <h1 className="authentication-heading" aria-label={heading}>
            {mode === "signin" ? "Sign in" : heading}
          </h1>
          <p className="authentication-subtitle">
            {mode === "signup"
              ? "Create an account to work with your agents."
              : mode === "request"
                ? "We'll email you instructions to reset your password."
                : mode === "reset"
                  ? "Choose a new password for your Otto account."
                  : "Pick up where you and your agents left off."}
          </p>
        </header>
        <form
          className="authentication-form"
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
          <FieldGroup className="authentication-fields">
            {mode === "signup" && (
              <Field className="gap-2">
                <FieldLabel className="sr-only" htmlFor="name">
                  Name
                </FieldLabel>
                <Input
                  className="authentication-input"
                  id="name"
                  name="name"
                  placeholder="Name"
                  autoComplete="name"
                  required
                  disabled={pending}
                  maxLength={200}
                />
              </Field>
            )}
            {mode !== "reset" && (
              <Field className="gap-2">
                <FieldLabel className="sr-only" htmlFor="email">
                  Email
                </FieldLabel>
                <Input
                  className="authentication-input"
                  id="email"
                  name="email"
                  placeholder="Email"
                  type="email"
                  autoComplete="username"
                  required
                  disabled={pending}
                  maxLength={254}
                />
              </Field>
            )}
            {mode !== "request" && (
              <Field className="gap-2">
                <FieldLabel className="sr-only" htmlFor="password">
                  {mode === "reset" ? "New password" : "Password"}
                </FieldLabel>
                <InputGroup className="authentication-password">
                  <InputGroupInput
                    className="authentication-input"
                    id="password"
                    name="password"
                    placeholder={mode === "reset" ? "New password" : "Password"}
                    type={passwordShown ? "text" : "password"}
                    autoComplete={
                      mode === "signup" || mode === "reset"
                        ? "new-password"
                        : "current-password"
                    }
                    minLength={mode === "signin" ? undefined : 12}
                    required
                    disabled={pending}
                  />
                  <InputGroupAddon align="inline-end">
                    <Button
                      className="authentication-password-toggle"
                      type="button"
                      variant="ghost"
                      size="icon-compact"
                      aria-label={
                        passwordShown ? "Hide password" : "Show password"
                      }
                      aria-pressed={passwordShown}
                      disabled={pending}
                      onClick={(event) => {
                        setPasswordShown(!passwordShown);
                        event.currentTarget
                          .closest("[data-slot=input-group]")
                          ?.querySelector("input")
                          ?.focus();
                      }}
                    >
                      {passwordShown ? <RiEyeOffLine /> : <RiEyeLine />}
                    </Button>
                  </InputGroupAddon>
                </InputGroup>
              </Field>
            )}
            {error && <FieldError>{error}</FieldError>}
            {message && (
              <FieldDescription role="status">{message}</FieldDescription>
            )}
            <Button
              className="authentication-submit"
              type="submit"
              size="sm"
              disabled={pending}
            >
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
            <div className="authentication-actions">
              {mode !== "signin" && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setMode("signin");
                    setPasswordShown(false);
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
                      setPasswordShown(false);
                      setError(undefined);
                      setMessage(undefined);
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
                      setPasswordShown(false);
                      setError(undefined);
                      setMessage(undefined);
                    }}
                  >
                    Forgot password
                  </Button>
                </>
              )}
            </div>
          </FieldGroup>
        </form>
      </div>
    </main>
  );
}
