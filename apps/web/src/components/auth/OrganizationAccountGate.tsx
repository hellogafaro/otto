import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { z } from "zod";
import {
  createOrganizationAccountsClient,
  getOrganizationAccountState,
} from "@otto/client-runtime/authorization";
import type { OrganizationAccountState } from "@otto/contracts";
import { readPrimaryEnvironmentTarget } from "~/environments/primary";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Field, FieldError, FieldLabel } from "../ui/field";
import { Form } from "../ui/form";
import { Alert, AlertDescription } from "../ui/alert";
import { Spinner } from "../ui/spinner";
import { AuthSurfaceShell, AuthSurfaceSection } from "./AuthSurfaceShell";

type AccountPage = "setup" | "login" | "invite" | "reset";

type SetupStep = "token" | "account" | "organization";

const accountFields = {
  credential: {
    label: "Setup token",
    type: "password",
    autoComplete: "off",
    schema: z.string().trim().min(1, "Enter your setup token.").max(512),
  },
  firstName: {
    label: "First name",
    type: "text",
    autoComplete: "given-name",
    schema: z.string().trim().min(1, "Enter your first name.").max(80),
  },
  lastName: {
    label: "Last name",
    type: "text",
    autoComplete: "family-name",
    schema: z.string().trim().min(1, "Enter your last name.").max(80),
  },
  email: {
    label: "Email",
    type: "email",
    autoComplete: "email",
    schema: z.email("Enter a valid email address.").max(254),
  },
  password: {
    label: "Password",
    type: "password",
    autoComplete: "current-password",
    schema: z.string().min(8, "Use at least 8 characters.").max(128),
  },
  organizationName: {
    label: "Organization name",
    type: "text",
    autoComplete: "organization",
    schema: z.string().trim().min(1, "Enter your organization’s name.").max(80),
  },
};

type AccountFieldName = keyof typeof accountFields;

const setupSteps = {
  token: {
    title: "Enter your setup token",
    description: "Use the token from your server terminal to authorize setup.",
    number: 1,
    fields: ["credential"],
  },
  account: {
    title: "Create your account",
    description: "You’ll be the first admin of this organization.",
    number: 2,
    fields: ["firstName", "lastName", "email", "password"],
  },
  organization: {
    title: "Name your organization",
    description: "Your organization and its data will be saved on this server.",
    number: 3,
    fields: ["organizationName"],
  },
} satisfies Record<
  SetupStep,
  { title: string; description: string; number: number; fields: AccountFieldName[] }
>;

export function OrganizationAccountGate({
  page,
  invitationId,
}: {
  readonly page: AccountPage;
  readonly invitationId?: string;
}) {
  const baseURL = readPrimaryEnvironmentTarget()?.target.httpBaseUrl ?? window.location.origin;
  const client = useMemo(() => createOrganizationAccountsClient(baseURL), [baseURL]);
  const [state, setState] = useState<OrganizationAccountState | null>(null);

  const [mode, setMode] = useState<"login" | "signup" | "forgot">(
    page === "invite" && new URLSearchParams(window.location.search).get("mode") !== "signin"
      ? "signup"
      : "login",
  );

  const [setupToken] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "",
  );

  const [setupStep, setSetupStep] = useState<SetupStep>(setupToken ? "account" : "token");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (page === "setup") heading.current?.focus({ preventScroll: true });
  }, [page, setupStep]);

  useEffect(() => {
    let cancelled = false;
    void getOrganizationAccountState(baseURL)
      .then((value) => {
        if (cancelled) return;

        if (!value.organization && page !== "setup") {
          window.location.replace(`/setup${window.location.hash}`);

          return;
        }

        setState(value);

        if (page === "setup" && value.organization) window.location.replace("/login");

        if (page === "login" && value.role) window.location.replace("/");
      })
      .catch(() => {
        if (!cancelled) setError("Could not connect to the organization.");
      });

    return () => {
      cancelled = true;
    };
  }, [baseURL, page]);

  const acceptInvitation = async () => {
    if (!invitationId) return;
    const result = await client.organization.acceptInvitation({ invitationId });

    if (result.error) throw new Error(result.error.message ?? "Could not accept the invitation.");
  };

  const form = useForm({
    defaultValues: {
      credential: setupToken,
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      organizationName: "",
    },
    onSubmit: async ({ value }): Promise<void> => {
      setError(null);
      setNotice(null);

      if (page === "setup" && setupStep !== "organization") {
        form.reset(value, { keepDefaultValues: true });
        setSetupStep(setupStep === "token" ? "account" : "organization");

        return;
      }

      try {
        if (page === "setup") {
          const result = await client.$fetch(
            new URL("/api/organization/setup", baseURL).toString(),
            {
              method: "POST",
              body: { ...value, credential: value.credential.trim() },
            },
          );

          if (result.error) {
            if (result.error.status === 403) {
              form.reset(value, { keepDefaultValues: true });
              setSetupStep("token");
            }

            throw new Error(result.error.message ?? "Organization setup failed.");
          }

          window.history.replaceState({}, "", "/setup");
          form.setFieldValue("password", "");
          form.setFieldValue("credential", "");
          setNotice(
            "Your organization is ready. Check your email to verify your account, then sign in.",
          );
        } else if (page === "reset") {
          const token = new URLSearchParams(window.location.search).get("token") ?? "";
          const result = await client.resetPassword({ newPassword: value.password, token });

          if (result.error)
            throw new Error(result.error.message ?? "Could not reset your password.");
          form.setFieldValue("password", "");
          setNotice("Your password has been changed. You can sign in now.");
        } else if (mode === "forgot") {
          const result = await client.requestPasswordReset({
            email: value.email,
            redirectTo: `${window.location.origin}/reset-password`,
          });

          if (result.error)
            throw new Error(result.error.message ?? "Could not request a password reset.");
          setNotice("If an account exists for that email, you will receive a password reset link.");
        } else if (mode === "signup") {
          const registration = {
            email: value.email,
            password: value.password,
            firstName: value.firstName.trim(),
            lastName: value.lastName.trim(),
            name: `${value.firstName.trim()} ${value.lastName.trim()}`,
            callbackURL: `${window.location.origin}/invite/${encodeURIComponent(invitationId ?? "")}?mode=signin`,
            invitationId,
          };

          const result = await client.signUp.email(registration);

          if (result.error)
            throw new Error(result.error.message ?? "Could not create your account.");
          form.setFieldValue("password", "");
          setNotice(
            "Check your email to verify your account, then sign in to accept the invitation.",
          );
        } else {
          const result = await client.signIn.email({
            email: value.email,
            password: value.password,
          });

          if (result.error) throw new Error(result.error.message ?? "Could not sign in.");
          await acceptInvitation();
          const current = await getOrganizationAccountState(baseURL);

          if (!current.role)
            throw new Error(
              "This account is not a member of the organization. Ask an admin for an invitation.",
            );
          window.location.replace("/");
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The account request failed.");
      }
    },
  });

  const isSubmitting = useStore(form.store, (value) => value.isSubmitting);
  const busy = pending || isSubmitting;
  const step = setupSteps[setupStep];
  const setupBlocked = page === "setup" && setupStep === "organization" && !state?.mailConfigured;

  const visibleFields: AccountFieldName[] =
    page === "setup"
      ? step.fields
      : page === "reset"
        ? ["password"]
        : mode === "forgot"
          ? ["email"]
          : mode === "signup"
            ? ["firstName", "lastName", "email", "password"]
            : ["email", "password"];

  const title =
    page === "setup"
      ? step.title
      : page === "reset"
        ? "Reset your password"
        : mode === "forgot"
          ? "Forgot your password?"
          : page === "invite"
            ? `Join ${state?.organization?.name ?? "your organization"}`
            : `Sign in${state?.organization ? ` to ${state.organization.name}` : ""}`;

  const description =
    page === "setup"
      ? step.description
      : page === "reset"
        ? "Choose a new password for your account."
        : mode === "forgot"
          ? "Enter your email and we’ll send you a reset link."
          : page === "invite"
            ? "Join your team on Otto."
            : "Welcome back. Sign in to your organization.";

  const submitLabel =
    page === "setup"
      ? setupStep === "organization"
        ? "Create organization"
        : "Next"
      : page === "reset"
        ? "Reset password"
        : mode === "forgot"
          ? "Send reset link"
          : mode === "signup"
            ? "Create account"
            : invitationId
              ? "Sign in and join"
              : "Sign in";

  return (
    <AuthSurfaceShell>
      <AuthSurfaceSection>
        {page === "setup" && !notice ? (
          <p className="text-xs text-muted-foreground">Step {step.number} of 3</p>
        ) : null}
        <h1 ref={heading} tabIndex={-1} className="text-xl font-medium outline-none">
          {notice ? (page === "reset" ? "Password reset" : "Check your email") : title}
        </h1>
        {!notice ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </AuthSurfaceSection>
      <AuthSurfaceSection>
        {!state && !error ? <Spinner /> : null}
        {error ? (
          <Alert variant="error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <div className="flex flex-col gap-5">
            <Alert variant="success">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                if (page === "invite") {
                  setMode("login");
                  setNotice(null);
                } else window.location.assign("/login");
              }}
            >
              Continue to sign in
            </Button>
          </div>
        ) : state ? (
          <div className="flex flex-col gap-5">
            {setupBlocked ? (
              <Alert>
                <AlertDescription>
                  Configure organization email on the server before creating the first account.
                </AlertDescription>
              </Alert>
            ) : null}
            {page === "invite" && state.user ? (
              <div className="flex flex-col gap-3">
                <p>Signed in as {state.user.email}.</p>
                <Button
                  variant="primary"
                  size="lg"
                  disabled={busy}
                  onClick={async () => {
                    setPending(true);
                    setError(null);

                    try {
                      if (!state.role) await acceptInvitation();
                      window.location.replace("/");
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : "Could not join.");
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  {state.role ? "Open organization" : "Accept invitation"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    const result = await client.signOut();

                    if (result.error) {
                      setError(result.error.message ?? "Could not sign out.");

                      return;
                    }

                    window.location.reload();
                  }}
                >
                  Use another account
                </Button>
              </div>
            ) : state.organization || page === "setup" ? (
              <Form
                noValidate
                spacing="compact"
                onSubmit={(event) => {
                  event.preventDefault();

                  if (!busy && !setupBlocked) void form.handleSubmit();
                }}
              >
                {visibleFields.map((name) => {
                  const definition = accountFields[name];

                  const label =
                    name === "password" && page === "reset" ? "New password" : definition.label;

                  return (
                    <form.Field key={name} name={name} validators={{ onSubmit: definition.schema }}>
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched && field.state.meta.errors.length > 0;

                        return (
                          <Field invalid={invalid} data-invalid={invalid}>
                            <FieldLabel className="sr-only" htmlFor={`auth-${name}`}>
                              {label}
                            </FieldLabel>
                            <Input
                              nativeInput
                              id={`auth-${name}`}
                              name={field.name}
                              type={definition.type}
                              size="lg"
                              placeholder={label}
                              value={field.state.value}
                              onChange={(event) => field.handleChange(event.target.value)}
                              onBlur={field.handleBlur}
                              aria-invalid={invalid}
                              aria-describedby={invalid ? `auth-${name}-error` : undefined}
                              aria-required="true"
                              disabled={busy}
                              autoComplete={
                                name === "password" &&
                                (page === "setup" || page === "reset" || mode === "signup")
                                  ? "new-password"
                                  : definition.autoComplete
                              }
                            />
                            {invalid ? (
                              <FieldError match id={`auth-${name}-error`}>
                                {field.state.meta.errors.map((issue) => issue?.message).join(" ")}
                              </FieldError>
                            ) : null}
                          </Field>
                        );
                      }}
                    </form.Field>
                  );
                })}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={busy || setupBlocked}
                  className="mt-2"
                >
                  {busy ? <Spinner /> : null}
                  {submitLabel}
                </Button>
                {page === "setup" && setupStep !== "token" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      form.reset(form.state.values, { keepDefaultValues: true });
                      setSetupStep(setupStep === "organization" ? "account" : "token");
                    }}
                  >
                    Back
                  </Button>
                ) : null}
                {page === "invite" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setMode(mode === "signup" ? "login" : "signup");
                      setError(null);
                      form.reset(form.state.values, { keepDefaultValues: true });
                    }}
                  >
                    {mode === "signup" ? "Already have an account? Sign in" : "Create an account"}
                  </Button>
                ) : null}
                {page === "login" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setMode(mode === "forgot" ? "login" : "forgot");
                      setError(null);
                      form.reset(form.state.values, { keepDefaultValues: true });
                    }}
                  >
                    {mode === "forgot" ? "Back to sign in" : "Forgot password?"}
                  </Button>
                ) : null}
              </Form>
            ) : null}
          </div>
        ) : null}
      </AuthSurfaceSection>
    </AuthSurfaceShell>
  );
}
