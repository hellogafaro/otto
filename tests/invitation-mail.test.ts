import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sendInvitation } from "../apps/server/src/invitations";
import { createSmtpMail } from "../apps/server/src/mail";
import {
  claimInstallation,
  createInvitation,
  getInvitation,
  inWorkspace,
} from "../packages/workspaces/src";
import { users } from "../packages/workspaces/src/schema";
import { startSmtp } from "./fixtures/smtp";
import { startPostgres } from "./postgres";

describe("invitation delivery to a local SMTP server", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let invitation: Awaited<ReturnType<typeof createInvitation>>;
  beforeAll(async () => {
    database = await startPostgres();
    await database.db.insert(users).values({
      id: "invitation-sender",
      name: "Sender",
      email: "sender@example.test",
      emailVerified: true,
    });
    const workspace = await claimInstallation(
      database.db,
      "invitation-sender",
      "Delivery",
    );
    const created = await inWorkspace(
      database.db,
      workspace.id,
      { userId: "invitation-sender" },
      (context) =>
        createInvitation(context, {
          email: "recipient@example.test",
          role: "contributor",
        }),
    );
    invitation = await inWorkspace(
      database.db,
      workspace.id,
      { userId: "invitation-sender" },
      (context) => getInvitation(context, created.id),
      false,
    );
  });
  afterAll(async () => {
    await database?.stop();
  });
  it("uses the committed recipient and stable retry identity without claiming a provider error succeeded", async () => {
    let reject = false;
    const sink = await startSmtp({
      onData() {
        if (reject) return new Error("private provider detail");
      },
    });
    const received = sink.messages;
    const mail = createSmtpMail({
      from: "otto@example.test",
      host: sink.host,
      port: sink.port,
      tls: "none",
    });
    const options = { mail, origin: "http://localhost:43001", invitation };
    try {
      expect(await sendInvitation(options)).toBe("sent");
      expect(await sendInvitation(options)).toBe("sent");
      expect(received[0]?.to).toEqual([invitation.email]);
      expect(received[0]?.text).toContain(invitation.id);
      expect(received[0]?.text).toContain(options.origin);
      expect(received[0]?.messageId).toBe(received[1]?.messageId);
      expect(Boolean(received[0]?.messageId)).toBe(true);
      reject = true;
      expect(await sendInvitation(options)).toBe("uncertain");
      expect(received.length).toBe(3);
      expect(await sendInvitation({ ...options, mail: undefined })).toBe(
        "unavailable",
      );
      expect(
        await sendInvitation({
          ...options,
          invitation: { ...invitation, revokedAt: new Date() },
        }),
      ).toBe("unavailable");
      expect(
        await sendInvitation({
          ...options,
          invitation: { ...invitation, expiresAt: new Date(0) },
        }),
      ).toBe("unavailable");
      expect(received.length).toBe(3);
    } finally {
      await sink.close();
    }
  });
});
