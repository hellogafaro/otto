import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { z } from "zod";
import {
  createOrganizationAccountsClient,
  getOrganizationAccountState,
} from "@otto/client-runtime/authorization";
import type { OrganizationAccountState } from "@otto/contracts";
import { readPrimaryEnvironmentTarget } from "~/environments/primary";
import {
  readDesktopSessionToken,
  storeDesktopSessionToken,
} from "~/environments/primary/desktop-auth";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Field, FieldError, FieldLabel } from "../ui/field";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../ui/input-otp";
import { Form } from "../ui/form";
import { Alert, AlertDescription } from "../ui/alert";
import { Spinner } from "../ui/spinner";
import {
  AuthActions,
  AuthSecondaryButton,
  AuthSurfaceShell,
  AuthSurfaceSection,
} from "./auth-surface-shell";
import { DesktopServerPage } from "./desktop-server-page";
import { useI18n } from "../../i18n";

type AccountPage = "setup" | "login" | "invite" | "reset";

type SetupStep = "account" | "organization";

const accountFields = {
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
  setupCode: {
    label: "Setup code",
    type: "password",
    autoComplete: "off",
    schema: z.string().max(256),
  },
};

type AccountFieldName = keyof typeof accountFields;

const setupSteps = {
  account: {
    title: "Create your account",
    description: "You’ll be the first admin of this organization.",
    number: 1,
    fields: ["firstName", "lastName", "email", "password"],
  },
  organization: {
    title: "Name your organization",
    description: "Your organization and its data will be saved on this server.",
    number: 2,
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
  const { t } = useI18n();
  const baseURL = readPrimaryEnvironmentTarget()?.target.httpBaseUrl ?? window.location.origin;
  const [desktopToken] = useState(readDesktopSessionToken);
  const desktopAccounts = { bearer: Boolean(window.desktopBridge) };

  const client = useMemo(
    () => createOrganizationAccountsClient(baseURL, desktopToken ?? undefined, desktopAccounts),
    [baseURL, desktopToken],
  );

  const [state, setState] = useState<OrganizationAccountState | null>(null);

  const [mode, setMode] = useState<"login" | "signup">(
    page === "invite" && new URLSearchParams(window.location.search).get("mode") !== "signin"
      ? "signup"
      : "login",
  );

  // Otto: A fresh server's first visitor sets it up; no token, the owner has the server.
  const [setupStep, setSetupStep] = useState<SetupStep>("account");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string; text: string } | null>(null);
  // Otto: with mail, sign-in sends a one-time code to this address and asks for it.
  const [codeEmail, setCodeEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeResent, setCodeResent] = useState(false);
  const [pending, setPending] = useState(false);
  const [serverPage, setServerPage] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (page === "setup") heading.current?.focus({ preventScroll: true });
  }, [page, setupStep, state]);

  useEffect(() => {
    let cancelled = false;
    void getOrganizationAccountState(baseURL, desktopToken ?? undefined, desktopAccounts)
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
  }, [baseURL, desktopToken, page]);

  const acceptInvitation = async (token: string | undefined) => {
    if (!invitationId) return;

    const result = await createOrganizationAccountsClient(
      baseURL,
      token,
      desktopAccounts,
    ).organization.acceptInvitation({ invitationId });

    if (result.error) throw new Error(result.error.message ?? "Could not accept the invitation.");
  };

  const form = useForm({
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      organizationName: "",
      setupCode: "",
    },
    onSubmit: async ({ value }): Promise<void> => {
      setError(null);
      setNotice(null);

      const registration = {
        email: value.email,
        password: value.password,
        firstName: value.firstName.trim(),
        lastName: value.lastName.trim(),
        name: `${value.firstName.trim()} ${value.lastName.trim()}`,
        callbackURL: `${window.location.origin}/invite/${encodeURIComponent(invitationId ?? "")}?mode=signin`,
        invitationId,
      };

      if (page === "setup" && setupStep !== "organization") {
        form.reset(value, { keepDefaultValues: true });
        setSetupStep("organization");

        return;
      }

      try {
        if (page === "setup") {
          const result = await client.$fetch<{ verificationRequired: boolean }>(
            new URL("/api/organization/setup", baseURL).toString(),
            {
              method: "POST",
              body: value,
            },
          );

          if (result.error) throw new Error(result.error.message ?? "Organization setup failed.");

          form.setFieldValue("password", "");
          form.setFieldValue("setupCode", "");

          setNotice(
            result.data?.verificationRequired
              ? {
                  title: "Check your email",
                  text: "Your organization is ready. Check your email to verify your account, then sign in.",
                }
              : { title: t("Organization ready"), text: t("Your organization is ready. Sign in.") },
          );
        } else if (page === "reset") {
          const token = new URLSearchParams(window.location.search).get("token") ?? "";
          const result = await client.resetPassword({ newPassword: value.password, token });

          if (result.error)
            throw new Error(result.error.message ?? "Could not reset your password.");
          form.setFieldValue("password", "");
          setNotice({
            title: "Password reset",
            text: "Your password has been changed. You can sign in now.",
          });
        } else if (mode === "signup" && state?.mailConfigured) {
          const result = await client.signUp.email(registration);

          if (result.error)
            throw new Error(result.error.message ?? "Could not create your account.");
          form.setFieldValue("password", "");
          setNotice({
            title: "Check your email",
            text: "Check your email to verify your account, then sign in to accept the invitation.",
          });
        } else if (state?.mailConfigured && !codeEmail) {
          const result = await client.emailOtp.sendVerificationOtp({
            email: value.email,
            type: "sign-in",
          });

          if (result.error) throw new Error(result.error.message ?? t("Could not send a code."));
          setCode("");
          setCodeResent(false);
          setCodeEmail(value.email);
        } else {
          let signedInToken: string | undefined;

          const onSuccess = (context: { response: Response }) => {
            signedInToken = context.response.headers.get("set-auth-token") ?? undefined;
          };

          // Otto: without mail an invite link is the proof, so a new account signs straight in.
          const result =
            mode === "signup"
              ? await client.signUp.email(registration, { onSuccess })
              : codeEmail
                ? await client.signIn.emailOtp({ email: codeEmail, otp: code }, { onSuccess })
                : await client.signIn.email(
                    { email: value.email, password: value.password },
                    { onSuccess },
                  );

          if (result.error) throw new Error(result.error.message ?? "Could not sign in.");
          const token = window.desktopBridge ? signedInToken : undefined;

          if (window.desktopBridge && !token)
            throw new Error("The server did not return a session for this app.");
          storeDesktopSessionToken(token ?? null);
          await acceptInvitation(token);
          const current = await getOrganizationAccountState(baseURL, token, desktopAccounts);

          // Otto: a signed-in non-member sees their account instead of the form, so retrying
          // cannot spend more sign-in attempts.
          if (!current.role) window.location.reload();
          else window.location.replace("/");
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The account request failed.");
      }
    },
  });

  const isSubmitting = useStore(form.store, (value) => value.isSubmitting);
  const busy = pending || isSubmitting;
  const step = setupSteps[setupStep];

  const codeSignIn =
    page !== "setup" && page !== "reset" && mode === "login" && state?.mailConfigured;

  const codeStep = codeSignIn && codeEmail !== null;

  const visibleFields: AccountFieldName[] =
    page === "setup"
      ? setupStep === "organization" && state?.setupCodeRequired
        ? [...step.fields, "setupCode"]
        : step.fields
      : page === "reset"
        ? ["password"]
        : mode === "signup"
          ? ["firstName", "lastName", "email", "password"]
          : codeStep
            ? []
            : codeSignIn
              ? ["email"]
              : ["email", "password"];

  const title =
    page === "setup"
      ? step.title
      : page === "reset"
        ? "Reset your password"
        : codeStep
          ? t("Check your email")
          : page === "invite"
            ? `Join ${state?.organization?.name ?? "your organization"}`
            : `Sign in${state?.organization ? ` to ${state.organization.name}` : ""}`;

  const description =
    page === "setup"
      ? setupStep === "organization" && state?.setupCodeRequired
        ? t("Enter the setup code from the server’s OTTO_SETUP_TOKEN setting.")
        : step.description
      : page === "reset"
        ? "Choose a new password for your account."
        : codeStep
          ? codeResent
            ? t("We sent a new code to {email}.", { email: codeEmail ?? "" })
            : t("Enter the code we sent to {email}.", { email: codeEmail ?? "" })
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
        : mode === "signup"
          ? "Create account"
          : codeSignIn && !codeStep
            ? t("Send code")
            : invitationId
              ? "Sign in and join"
              : "Sign in";

  if (serverPage) return <DesktopServerPage onBack={() => setServerPage(false)} />;

  // Otto: the boot splash from index.html stays up until we know which screen to show.
  if (!state && !error)
    return (
      <div id="boot-shell" className="min-h-dvh">
        <div id="boot-shell-card" aria-label="Otto splash screen">
          <img id="boot-shell-logo" src="/otto-logo.svg" alt="Otto" />
        </div>
      </div>
    );

  const serverButton =
    window.desktopBridge?.setServerUrl && !notice ? (
      <AuthSecondaryButton disabled={busy} onClick={() => setServerPage(true)}>
        {t("Use another server")}
      </AuthSecondaryButton>
    ) : null;

  return (
    <AuthSurfaceShell>
      <AuthSurfaceSection className="gap-2">
        {page === "setup" && !notice ? (
          <p className="text-xs text-muted-foreground">Step {step.number} of 2</p>
        ) : null}
        <h1 ref={heading} tabIndex={-1} className="text-xl leading-title font-medium outline-none">
          {notice ? notice.title : title}
        </h1>
        {!notice ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </AuthSurfaceSection>
      <AuthSurfaceSection>
        {error ? (
          <Alert variant="error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <div className="flex flex-col gap-5">
            <Alert variant="success">
              <AlertDescription>{notice.text}</AlertDescription>
            </Alert>
            <Button
              variant="primary"
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
            {(page === "invite" || page === "login") && state.user ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">Signed in as {state.user.email}.</p>
                {page === "login" ? (
                  <Alert variant="error">
                    <AlertDescription>
                      This account is not a member of the organization. Ask an admin for an
                      invitation.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <AuthActions>
                  {page === "login" ? null : (
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={async () => {
                        setPending(true);
                        setError(null);

                        try {
                          if (!state.role) await acceptInvitation(desktopToken ?? undefined);
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
                  )}
                  <AuthSecondaryButton
                    disabled={busy}
                    onClick={async () => {
                      const result = await client.signOut();

                      if (result.error) {
                        setError(result.error.message ?? "Could not sign out.");

                        return;
                      }

                      storeDesktopSessionToken(null);
                      window.location.reload();
                    }}
                  >
                    Use another account
                  </AuthSecondaryButton>
                  {serverButton}
                </AuthActions>
              </div>
            ) : state.organization || page === "setup" ? (
              <Form
                noValidate
                spacing="compact"
                onSubmit={(event) => {
                  event.preventDefault();

                  if (!busy) void form.handleSubmit();
                }}
              >
                {codeStep ? (
                  <InputOTP
                    containerClassName="w-full"
                    autoFocus
                    maxLength={6}
                    inputMode="numeric"
                    pattern="^[0-9]*$"
                    autoComplete="one-time-code"
                    aria-label={t("Sign-in code")}
                    value={code}
                    disabled={busy}
                    onChange={setCode}
                    onComplete={() => void form.handleSubmit()}
                  >
                    <InputOTPGroup className="w-full">
                      {[0, 1, 2, 3, 4, 5].map((index) => (
                        <InputOTPSlot key={index} index={index} className="flex-1" />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                ) : null}
                {visibleFields.map((name) => {
                  const definition = accountFields[name];

                  const label =
                    name === "setupCode"
                      ? t("Setup code")
                      : name === "password" && page === "reset"
                        ? "New password"
                        : definition.label;

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
                <AuthActions>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={busy || (codeStep && code.length < 6)}
                  >
                    {busy ? <Spinner /> : null}
                    {submitLabel}
                  </Button>
                  {page === "setup" && setupStep === "organization" ? (
                    <AuthSecondaryButton
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        form.reset(form.state.values, { keepDefaultValues: true });
                        setSetupStep("account");
                      }}
                    >
                      Back
                    </AuthSecondaryButton>
                  ) : null}
                  {page === "invite" ? (
                    <AuthSecondaryButton
                      disabled={busy}
                      onClick={() => {
                        setMode(mode === "signup" ? "login" : "signup");
                        setError(null);
                        form.reset(form.state.values, { keepDefaultValues: true });
                      }}
                    >
                      {mode === "signup" ? "Already have an account? Sign in" : "Create an account"}
                    </AuthSecondaryButton>
                  ) : null}
                  {codeStep ? (
                    <>
                      <AuthSecondaryButton
                        disabled={busy}
                        onClick={async () => {
                          if (!codeEmail) return;
                          setPending(true);
                          setError(null);
                          setCode("");

                          const result = await client.emailOtp.sendVerificationOtp({
                            email: codeEmail,
                            type: "sign-in",
                          });

                          setPending(false);

                          if (result.error) {
                            setError(result.error.message ?? t("Could not send a code."));

                            return;
                          }

                          setCodeResent(true);
                        }}
                      >
                        {t("Send a new code")}
                      </AuthSecondaryButton>
                      <AuthSecondaryButton
                        disabled={busy}
                        onClick={() => {
                          setError(null);
                          setCodeEmail(null);
                        }}
                      >
                        {t("Use another email")}
                      </AuthSecondaryButton>
                    </>
                  ) : null}
                  {serverButton}
                </AuthActions>
              </Form>
            ) : (
              serverButton
            )}
          </div>
        ) : (
          serverButton
        )}
      </AuthSurfaceSection>
    </AuthSurfaceShell>
  );
}
