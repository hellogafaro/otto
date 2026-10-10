import type { AddressInfo, Socket } from "node:net";
import { simpleParser } from "mailparser";
import {
  SMTPServer,
  type SMTPServerOptions,
  type SMTPServerSession,
} from "smtp-server";

export interface SmtpMessage {
  to: string[];
  subject: string;
  text: string;
  messageId: string | undefined;
}

export async function startSmtp(
  options: {
    serverOptions?: SMTPServerOptions;
    onError?: (error: Error) => boolean;
    onData?: (
      message: SmtpMessage,
      session: SMTPServerSession,
    ) => Error | void | Promise<Error | undefined> | Promise<void>;
  } = {},
) {
  const messages: SmtpMessage[] = [];
  const pending = new Set<Promise<void>>();
  const sockets = new Set<Socket>();
  const failures: unknown[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["AUTH", "STARTTLS"],
    logger: false,
    socketTimeout: 5000,
    closeTimeout: 5000,
    ...options.serverOptions,
    onData(stream, session, callback) {
      const work = (async () => {
        try {
          const parsed = await simpleParser(stream);
          const recipients = Array.isArray(parsed.to)
            ? parsed.to
            : parsed.to
              ? [parsed.to]
              : [];
          const message = {
            to: recipients.flatMap((recipient) =>
              recipient.value.flatMap((value) =>
                value.address ? [value.address] : [],
              ),
            ),
            subject: parsed.subject ?? "",
            text: (parsed.text ?? "").trimEnd(),
            messageId: parsed.messageId,
          };
          messages.push(message);
          callback((await options.onData?.(message, session)) ?? undefined);
        } catch (error) {
          failures.push(error);
          callback(new Error("SMTP fixture processing failed"));
        }
      })();
      pending.add(work);
      void work.finally(() => pending.delete(work));
    },
  });
  server.server.prependListener("connection", (socket: Socket) => {
    sockets.add(socket);
  });
  server.on("error", (error: Error) => {
    try {
      if (!options.onError?.(error)) failures.push(error);
    } catch (failure) {
      failures.push(failure);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.server.address() as AddressInfo;
  let closing: Promise<void> | undefined;
  return {
    host: "127.0.0.1",
    port: address.port,
    messages,
    close() {
      closing ??= (async () => {
        await new Promise<void>((resolve) => {
          server.server.once("close", resolve);
          server.close();
          for (const socket of sockets) socket.destroy();
        });
        await Promise.all(pending);
        sockets.clear();
        if (failures.length)
          throw new AggregateError(failures, "SMTP fixture failed");
      })();
      return closing;
    },
  };
}
