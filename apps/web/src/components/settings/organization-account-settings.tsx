import { RiPencilLine } from "@remixicon/react";
import { useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { AVATAR_UPLOAD_MAX_FILE_BYTES, downscaleAvatarImage } from "../roster/avatar-upload";
import { PersonAvatar } from "../roster/person-avatar";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Form } from "../ui/form";
import { Alert, AlertDescription } from "../ui/alert";
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
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  SettingsPageContainer,
  SettingsPageSkeleton,
  SettingsRow,
  SettingsSection,
} from "./settings-layout";
import { signOut, useOrganizationAccounts } from "./use-organization-accounts";
import { useAutosave } from "~/hooks/use-autosave";

export function AccountSettingsPanel() {
  const { client, state, error: loadError, refresh } = useOrganizationAccounts();
  const [firstName, setFirstName] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
    return loadError ? (
      <SettingsPageContainer>{loadError}</SettingsPageContainer>
    ) : (
      <SettingsPageSkeleton />
    );

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
        <ProfilePhotoRow
          name={`${state.user.firstName} ${state.user.lastName}`}
          image={state.user.image ?? null}
          saveImage={async (image) => {
            const result = await client.updateUser({ image });

            if (result.error) return false;
            await refresh();

            return true;
          }}
          onError={setError}
        />
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
        <SettingsRow
          title="Password"
          description="Changing it signs you out everywhere else."
          control={
            <Button variant="outline" onClick={() => setPasswordOpen(true)}>
              Change password
            </Button>
          }
        />
      </SettingsSection>
      <SettingsSection title="Session">
        <SettingsRow
          title="Sign out"
          description="Sign out of Otto in this browser."
          control={
            <Button
              variant="outline"
              onClick={async () => {
                const failure = await signOut(client);

                if (failure) setError(failure);
              }}
            >
              Sign out
            </Button>
          }
        />
      </SettingsSection>
      <ChangePasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
        changePassword={async (currentPassword, newPassword) => {
          const result = await client.changePassword({
            currentPassword,
            newPassword,
            revokeOtherSessions: true,
          });

          if (result.error) return result.error.message ?? "Could not change your password.";
          setNotice("Password changed. Other sessions have been signed out.");

          return null;
        }}
      />
    </SettingsPageContainer>
  );
}

const PROFILE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Otto: the avatar is the control: hovering or focusing it darkens it under a pencil, and a
 * click picks a new photo, cropped to a small square JPEG here so the server stores only that.
 * A photo is replaced, never removed.
 */
function ProfilePhotoRow({
  name,
  image,
  saveImage,
  onError,
}: {
  readonly name: string;
  readonly image: string | null;
  /** Resolves to whether the server saved the photo. */
  readonly saveImage: (image: string) => Promise<boolean>;
  readonly onError: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);

  const save = async (next: string) => {
    setPending(true);
    const saved = await saveImage(next);
    setPending(false);

    if (!saved) onError(t("Could not save your photo."));
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    onError(null);

    if (!PROFILE_PHOTO_TYPES.includes(file.type)) {
      onError(t("Choose a JPG, PNG, WebP or GIF image."));

      return;
    }

    if (file.size > AVATAR_UPLOAD_MAX_FILE_BYTES) {
      onError(t("Image too large"));

      return;
    }

    const photo = await downscaleAvatarImage(file).catch(() => null);

    if (!photo) {
      onError(t("Could not read image"));

      return;
    }

    await save(photo);
  };

  return (
    <SettingsRow
      title={t("Photo")}
      description={t(
        "JPG, PNG, WebP or GIF up to 8 MB, cropped to a square. Everyone in your organization sees it.",
      )}
      control={
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={t("Change photo")}
                  disabled={pending}
                  onClick={() => input.current?.click()}
                  className="group/photo relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                />
              }
            >
              <PersonAvatar
                name={name}
                image={image}
                className="size-8 rounded-md border border-border/70 text-xs"
              />
              <span
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center rounded-md bg-media-mat/50 text-on-solid opacity-0 transition-opacity duration-(--duration-fast) group-hover/photo:opacity-100 group-focus-visible/photo:opacity-100 group-disabled/photo:opacity-100 motion-reduce:transition-none"
              >
                <RiPencilLine className="size-4" />
              </span>
            </TooltipTrigger>
            <TooltipPopup>{t("Change photo")}</TooltipPopup>
          </Tooltip>
          <input
            ref={input}
            type="file"
            accept={PROFILE_PHOTO_TYPES.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void upload(file);
            }}
          />
        </>
      }
    />
  );
}

/** Otto: Change password is a deliberate action, so it asks in a dialog rather than inline. */
function ChangePasswordDialog({
  open,
  onOpenChange,
  changePassword,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Resolves to an error message, or null once the password changed. */
  readonly changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const close = () => {
    onOpenChange(false);
    setCurrentPassword("");
    setNewPassword("");
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending && !next) close();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            At least 8 characters. Other sessions are signed out.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Form
            id="change-password"
            onSubmit={async (event) => {
              event.preventDefault();

              if (pending) return;
              setPending(true);
              setError(null);
              const failure = await changePassword(currentPassword, newPassword);
              setPending(false);

              if (failure) {
                setError(failure);

                return;
              }

              close();
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
            {error ? (
              <Alert variant="error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </Form>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="change-password" disabled={pending}>
            Change password
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
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
    return loadError ? (
      <SettingsPageContainer>{loadError}</SettingsPageContainer>
    ) : (
      <SettingsPageSkeleton />
    );

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
