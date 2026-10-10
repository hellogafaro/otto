import { readConfig } from "../../apps/server/src/config";
import { createSmtpMail } from "../../apps/server/src/mail";

try {
  const config = readConfig({
    ...process.env,
    DATABASE_URL: "postgresql://unused",
    BETTER_AUTH_SECRET: "smtp-fixture-only-not-an-auth-server-secret",
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    OTTO_ORIGIN: "http://localhost:43001",
  });
  if (
    !config.MAIL_FROM ||
    !config.SMTP_HOST ||
    !config.SMTP_PORT ||
    !config.SMTP_TLS
  )
    throw new Error("SMTP fixture configuration missing");
  await createSmtpMail({
    from: config.MAIL_FROM,
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    tls: config.SMTP_TLS,
    user: config.SMTP_USER,
    password: config.SMTP_PASSWORD,
  }).send({
    to: "recipient@example.test",
    subject: "SMTP fixture",
    text: "Controlled SMTP content",
    key: "smtp-fixture-message",
  });
} catch {
  process.exitCode = 1;
}
