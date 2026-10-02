import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { sendInvitation } from "../apps/server/src/invitations";
import { createResendMail } from "../apps/server/src/mail";
import {
  claimInstallation,
  createInvitation,
  getInvitation,
  inWorkspace,
} from "../packages/workspaces/src";
import { users } from "../packages/workspaces/src/schema";
import { startPostgres } from "./postgres";

const message = z.object({
  to: z.array(z.string()),
  subject: z.string(),
  text: z.string(),
});
describe("invitation delivery to a local HTTP sink", () => {
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
    const received: z.infer<typeof message>[] = [];
    const keys: (string | null)[] = [];
    let reject = false;
    const sink = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        keys.push(request.headers.get("idempotency-key"));
        received.push(message.parse(await request.json()));
        return reject
          ? new Response("private provider detail", { status: 503 })
          : Response.json({ id: crypto.randomUUID() });
      },
    });
    const request: typeof fetch = Object.assign(
      (
        _input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => fetch(sink.url, init),
      { preconnect: fetch.preconnect },
    );
    // Same memory-only inert fixture data as existing auth/mail tests; no external account.
    const mail = createResendMail(
      { from: "otto@example.test", apiKey: crypto.randomUUID() },
      request,
    );
    const options = { mail, origin: "http://localhost:43001", invitation };
    try {
      expect(await sendInvitation(options)).toBe("sent");
      expect(await sendInvitation(options)).toBe("sent");
      expect(received[0]?.to).toEqual([invitation.email]);
      expect(received[0]?.text).toContain(invitation.id);
      expect(received[0]?.text).toContain(options.origin);
      expect(keys[0]).toBe(keys[1]);
      expect(Boolean(keys[0])).toBe(true);
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
      await sink.stop(true);
    }
  });
});
