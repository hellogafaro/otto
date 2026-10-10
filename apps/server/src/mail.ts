import { createHash } from "node:crypto";
import { connect, type Socket } from "node:net";
import { createTransport } from "nodemailer";
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
export function createSmtpMail(config: {
  from: string;
  host: string;
  port: number;
  tls: "tls" | "starttls" | "none";
  user?: string;
  password?: string;
}): Mail {
  return {
    async send(input) {
      const message = messageSchema.parse(input);
      let socket: Socket | undefined;
      const deadline = setTimeout(() => socket?.destroy(), 10000);
      const transport = createTransport({
        host: config.host,
        port: config.port,
        secure: config.tls === "tls",
        requireTLS: config.tls === "starttls",
        ignoreTLS: config.tls === "none",
        tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
        auth: config.user
          ? { user: config.user, pass: config.password }
          : undefined,
        forceAuth: Boolean(config.user),
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
        getSocket(_options, callback) {
          socket = connect({
            host: config.host,
            port: config.port,
          });
          const failed = (error: Error) => {
            socket?.removeListener("close", closed);
            callback(error);
          };
          const closed = () => failed(new Error("SMTP connection closed"));
          socket.once("error", failed);
          socket.once("close", closed);
          socket.once("connect", () => {
            socket?.removeListener("error", failed);
            socket?.removeListener("close", closed);
            callback(null, { connection: socket });
          });
        },
      });
      try {
        await transport.sendMail({
          from: config.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          messageId: `<${createHash("sha256").update(message.key).digest("hex")}@${config.from.split("@")[1]}>`,
        });
      } catch {
        throw new Error("Mail delivery uncertain");
      } finally {
        clearTimeout(deadline);
        socket?.destroy();
        transport.close();
      }
    },
  };
}
