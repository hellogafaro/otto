import { createHash } from "node:crypto";
import { z } from "zod";

export interface Mail {
  send(message: {
    to: string;
    subject: string;
    text: string;
    key: string;
  }): Promise<void>;
}
const messageSchema = z.object({
  to: z.email().max(254),
  subject: z.string().min(1).max(200),
  text: z.string().min(1).max(16000),
  key: z.string().min(1).max(1000),
});
/** One concrete provider. No automatic resend after an ambiguous delivery outcome. */
export function createResendMail(
  config: { from: string; apiKey: string },
  request: typeof fetch = fetch,
): Mail {
  return {
    async send(input) {
      const message = messageSchema.parse(input);
      try {
        const response = await request("https://api.resend.com/emails", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": createHash("sha256")
              .update(message.key)
              .digest("hex"),
          },
          body: JSON.stringify({
            from: config.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
          }),
        });
        await response.body?.cancel();
        if (!response.ok) throw new Error("Mail delivery unavailable");
      } catch {
        // Provider bodies/errors can include message text, addresses or tokens.
        throw new Error("Mail delivery uncertain");
      }
    },
  };
}
