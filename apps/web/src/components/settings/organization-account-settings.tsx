import { useState, type FormEvent } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Form } from "../ui/form";
import { Alert, AlertDescription } from "../ui/alert";
import { Spinner } from "../ui/spinner";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settings-layout";
import { useOrganizationAccounts } from "./use-organization-accounts";

export function AccountSettingsPanel() {
  const { client, state, error: loadError, refresh } = useOrganizationAccounts();
  const [firstName, setFirstName] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!client || !state?.user)
    return <SettingsPageContainer>{loadError ?? <Spinner />}</SettingsPageContainer>;

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    try {
      const first = firstName ?? state.user!.firstName;
      const last = lastName ?? state.user!.lastName;

      const result = await client.updateUser({
        firstName: first,
        lastName: last,
        name: `${first} ${last}`,
      });

      if (result.error) throw new Error(result.error.message ?? "Could not save your account.");
      await refresh();
      setNotice("Account saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your account.");
    } finally {
      setPending(false);
    }
  };

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
      <Form onSubmit={saveProfile} className="contents">
        <SettingsSection
          title="Profile"
          headerAction={
            <Button type="submit" size="sm" disabled={pending}>
              Save
            </Button>
          }
        >
          <SettingsRow
            title="First name"
            control={
              <Input
                id="account-first-name"
                aria-label="First name"
                className="sm:w-64"
                value={firstName ?? state.user.firstName}
                onChange={(event) => setFirstName(event.target.value)}
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
                onChange={(event) => setLastName(event.target.value)}
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
      </Form>
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
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!client || !state?.organization)
    return <SettingsPageContainer>{loadError ?? <Spinner />}</SettingsPageContainer>;

  return (
    <SettingsPageContainer>
      <Form
        className="contents"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setMessage(null);

          try {
            const result = await client.organization.update({
              organizationId: state.organization!.id,
              data: { name: name ?? state.organization!.name },
            });

            if (result.error)
              throw new Error(result.error.message ?? "Could not save the organization.");
            await refresh();
            setMessage("Organization saved.");
          } catch (cause) {
            setMessage(cause instanceof Error ? cause.message : "Could not save the organization.");
          } finally {
            setPending(false);
          }
        }}
      >
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
              <>
                <Input
                  id="organization-name"
                  aria-label="Organization name"
                  className="sm:w-64"
                  value={name ?? state.organization.name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={80}
                  readOnly={state.role !== "admin"}
                />
                {state.role === "admin" ? (
                  <Button type="submit" disabled={pending}>
                    Save
                  </Button>
                ) : null}
              </>
            }
          />
        </SettingsSection>
      </Form>
    </SettingsPageContainer>
  );
}
