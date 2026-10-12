import { useState, type FormEvent } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Form } from "../ui/form";
import { Field, FieldLabel } from "../ui/field";
import { Alert, AlertDescription } from "../ui/alert";
import { Spinner } from "../ui/spinner";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { useOrganizationAccounts } from "./useOrganizationAccounts";

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
      <SettingsSection title="Account">
        <Form onSubmit={saveProfile}>
          <Field>
            <FieldLabel htmlFor="account-first-name">First name</FieldLabel>
            <Input
              id="account-first-name"
              value={firstName ?? state.user.firstName}
              onChange={(event) => setFirstName(event.target.value)}
              required
              maxLength={80}
              autoComplete="given-name"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="account-last-name">Last name</FieldLabel>
            <Input
              id="account-last-name"
              value={lastName ?? state.user.lastName}
              onChange={(event) => setLastName(event.target.value)}
              required
              maxLength={80}
              autoComplete="family-name"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="account-email">Email</FieldLabel>
            <Input id="account-email" type="email" value={state.user.email} readOnly />
          </Field>
          <Button type="submit" disabled={pending} className="self-start">
            Save
          </Button>
        </Form>
      </SettingsSection>
      <SettingsSection title="Password">
        <Form
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
          <Field>
            <FieldLabel htmlFor="current-password">Current password</FieldLabel>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              autoComplete="current-password"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
            />
          </Field>
          <Button type="submit" disabled={pending} className="self-start">
            Change password
          </Button>
        </Form>
      </SettingsSection>
      <Button
        variant="outline"
        disabled={pending}
        className="self-start"
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
      <SettingsSection title="Organization">
        <Form
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
              setMessage(
                cause instanceof Error ? cause.message : "Could not save the organization.",
              );
            } finally {
              setPending(false);
            }
          }}
        >
          <Field>
            <FieldLabel htmlFor="organization-name">Organization name</FieldLabel>
            <Input
              id="organization-name"
              value={name ?? state.organization.name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={80}
              readOnly={state.role !== "admin"}
            />
          </Field>
          {state.role === "admin" ? (
            <Button type="submit" disabled={pending} className="self-start">
              Save
            </Button>
          ) : null}
          {message ? <p role="status">{message}</p> : null}
        </Form>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
