import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Form } from "../ui/form";
import { Alert, AlertDescription } from "../ui/alert";
import { Spinner } from "../ui/spinner";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settings-layout";
import { storeDesktopSessionToken } from "~/environments/primary/desktop-auth";
import { useOrganizationAccounts } from "./use-organization-accounts";
import { useAutosave } from "~/hooks/use-autosave";

export function AccountSettingsPanel() {
  const { client, state, error: loadError, refresh } = useOrganizationAccounts();
  const [firstName, setFirstName] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Otto: names autosave like every other setting; only a changed, non-empty name is sent.
  const autosaveProfile = useAutosave(() => {
    const user = state?.user;

    if (!client || !user) return;
    const first = (firstName ?? user.firstName).trim();
    const last = (lastName ?? user.lastName).trim();

    if (!first || !last || (first === user.firstName && last === user.lastName)) return;
    setError(null);

    void client
      .updateUser({ firstName: first, lastName: last, name: `${first} ${last}` })
      .then(async (result) => {
        if (result.error) {
          setError(result.error.message ?? "Could not save your account.");

          return;
        }

        await refresh();
      });
  });

  if (!client || !state?.user)
    return <SettingsPageContainer>{loadError ?? <Spinner />}</SettingsPageContainer>;

  return (
    <SettingsPageContainer>
      {error ? (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert variant="success">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      <SettingsSection title="Profile">
        <SettingsRow
          title="First name"
          control={
            <Input
              id="account-first-name"
              aria-label="First name"
              className="sm:w-64"
              value={firstName ?? state.user.firstName}
              onChange={(event) => {
                setFirstName(event.target.value);
                autosaveProfile.schedule();
              }}
              onBlur={autosaveProfile.flush}
              required
              maxLength={80}
              autoComplete="given-name"
            />
          }
        />
        <SettingsRow
          title="Last name"
          control={
            <Input
              id="account-last-name"
              aria-label="Last name"
              className="sm:w-64"
              value={lastName ?? state.user.lastName}
              onChange={(event) => {
                setLastName(event.target.value);
                autosaveProfile.schedule();
              }}
              onBlur={autosaveProfile.flush}
              required
              maxLength={80}
              autoComplete="family-name"
            />
          }
        />
        <SettingsRow
          title="Email"
          control={
            <Input
              id="account-email"
              aria-label="Email"
              className="sm:w-64"
              type="email"
              value={state.user.email}
              readOnly
            />
          }
        />
      </SettingsSection>
      <Form
        className="contents"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setError(null);
          setNotice(null);

          try {
            const result = await client.changePassword({
              currentPassword,
              newPassword,
              revokeOtherSessions: true,
            });

            if (result.error)
              throw new Error(result.error.message ?? "Could not change your password.");
            setCurrentPassword("");
            setNewPassword("");
            setNotice("Password changed. Other sessions have been signed out.");
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not change your password.");
          } finally {
            setPending(false);
          }
        }}
      >
        <SettingsSection
          title="Password"
          headerAction={
            <Button type="submit" size="sm" disabled={pending}>
              Change password
            </Button>
          }
        >
          <SettingsRow
            title="Current password"
            control={
              <Input
                id="current-password"
                aria-label="Current password"
                className="sm:w-64"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                autoComplete="current-password"
              />
            }
          />
          <SettingsRow
            title="New password"
            description="At least 8 characters. Other sessions are signed out."
            control={
              <Input
                id="new-password"
                aria-label="New password"
                className="sm:w-64"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
              />
            }
          />
        </SettingsSection>
      </Form>
      <SettingsSection title="Session">
        <SettingsRow
          title="Sign out"
          description="Sign out of Otto in this browser."
          control={
            <Button
              variant="outline"
              disabled={pending}
              onClick={async () => {
                const result = await client.signOut();

                if (result.error) {
                  setError(result.error.message ?? "Could not sign out.");

                  return;
                }

                storeDesktopSessionToken(null);
                window.location.assign("/login");
              }}
            >
              Sign out
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function OrganizationSettingsPanel() {
  const { client, state, error: loadError, refresh } = useOrganizationAccounts();
  const [name, setName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Otto: the name autosaves like every other setting.
  const autosaveName = useAutosave(() => {
    const organization = state?.organization;

    if (!client || !organization || state.role !== "admin") return;
    const next = (name ?? organization.name).trim();

    if (!next || next === organization.name) return;
    setMessage(null);

    void client.organization
      .update({ organizationId: organization.id, data: { name: next } })
      .then(async (result) => {
        if (result.error) {
          setMessage(result.error.message ?? "Could not save the organization.");

          return;
        }

        await refresh();
      });
  });

  if (!client || !state?.organization)
    return <SettingsPageContainer>{loadError ?? <Spinner />}</SettingsPageContainer>;

  return (
    <SettingsPageContainer>
      <SettingsSection title="Organization">
        <SettingsRow
          title="Organization name"
          description={
            state.role === "admin"
              ? "Shown to everyone in this organization."
              : "Only admins can rename the organization."
          }
          status={message ? <span role="status">{message}</span> : null}
          control={
            <Input
              id="organization-name"
              aria-label="Organization name"
              className="sm:w-64"
              value={name ?? state.organization.name}
              onChange={(event) => {
                setName(event.target.value);
                autosaveName.schedule();
              }}
              onBlur={autosaveName.flush}
              required
              maxLength={80}
              readOnly={state.role !== "admin"}
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
