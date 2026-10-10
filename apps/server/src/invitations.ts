import type { Mail } from "./mail";

/** Call only after committing an authorized invitation or rechecking getInvitation. */
export async function sendInvitation(options: {
  mail?: Mail;
  origin: string;
  token?: string;
  invitation: {
    id: string;
    email: string;
    expiresAt: Date;
    acceptedAt?: Date | null;
    revokedAt?: Date | null;
  };
}): Promise<"sent" | "unavailable" | "uncertain"> {
  const { mail, origin, invitation, token } = options;
  if (
    !mail ||
    !token ||
    invitation.acceptedAt ||
    invitation.revokedAt ||
    invitation.expiresAt <= new Date()
  )
    return "unavailable";
  try {
    await mail.send({
      to: invitation.email,
      subject: "Your Otto invitation",
      text: [
        `You have been invited to Otto at ${origin}.`,
        `Invitation ID: ${invitation.id}`,
        `Invitation token: ${token}`,
        `Sign in with this email address and enter the invitation ID and token in Settings to accept. Keep the token private.`,
        `This invitation expires at ${invitation.expiresAt.toISOString()}.`,
      ].join("\n\n"),
      key: `invitation:${invitation.id}`,
    });
    return "sent";
  } catch {
    // Do not hide an uncertain external result or retry with another recipient.
    return "uncertain";
  }
}
