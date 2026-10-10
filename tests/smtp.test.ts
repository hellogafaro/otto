import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readConfig } from "../apps/server/src/config";
import { createSmtpMail } from "../apps/server/src/mail";
import { startSmtp } from "./fixtures/smtp";

const base = {
  DATABASE_URL: "postgresql://unused",
  BETTER_AUTH_SECRET: "smtp-fixture-only-not-an-auth-server-secret",
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  OTTO_ORIGIN: "http://localhost:43001",
};
const smtp = {
  MAIL_FROM: "otto@example.test",
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_TLS: "starttls",
};
const message = {
  to: "recipient@example.test",
  subject: "SMTP fixture",
  text: "Controlled SMTP content",
  key: "private-fixture-token",
};

describe("SMTP configuration", () => {
  it("keeps absent mail disabled and accepts explicit encrypted transports and paired authentication", () => {
    expect(readConfig(base).MAIL_FROM).toBeUndefined();
    for (const tls of ["tls", "starttls"])
      expect(readConfig({ ...base, ...smtp, SMTP_TLS: tls }).SMTP_TLS).toBe(
        tls,
      );
    expect(
      readConfig({
        ...base,
        ...smtp,
        SMTP_USER: "fixture",
        SMTP_PASSWORD: "fixture-password",
      }).SMTP_USER,
    ).toBe("fixture");
    for (const host of ["localhost", "127.0.0.1", "::1"])
      expect(
        readConfig({ ...base, ...smtp, SMTP_HOST: host, SMTP_TLS: "none" })
          .SMTP_TLS,
      ).toBe("none");
  });

  it("rejects every partial mail setup and never includes supplied values in errors", () => {
    for (const name of Object.keys(smtp)) {
      const partial: NodeJS.ProcessEnv = { ...smtp };
      delete partial[name];
      expect(() => readConfig({ ...base, ...partial })).toThrow(
        "Invalid configuration fields",
      );
    }
    for (const partial of [
      { SMTP_USER: "private-user" },
      { SMTP_PASSWORD: "private-password" },
      { SMTP_USER: "private-user", SMTP_PASSWORD: "private-password" },
      { ...smtp, SMTP_USER: "private-user" },
      { ...smtp, SMTP_PASSWORD: "private-password" },
    ]) {
      try {
        readConfig({ ...base, ...partial });
        expect.fail("Partial SMTP configuration was accepted");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(String(error)).toContain("Invalid configuration fields");
        expect(String(error)).not.toMatch(
          /private-user|private-password|example\.test/,
        );
      }
    }
  });

  it("refuses plaintext remote delivery, cleartext credentials and ambiguous endpoints", () => {
    for (const fields of [
      { SMTP_TLS: "none" },
      {
        SMTP_TLS: "none",
        SMTP_HOST: "localhost",
        SMTP_USER: "fixture",
        SMTP_PASSWORD: "fixture",
      },
      { SMTP_TLS: "false" },
      { SMTP_TLS: "" },
      { SMTP_PORT: "0" },
      { SMTP_PORT: "65536" },
      { SMTP_PORT: "" },
      { SMTP_HOST: "smtp://user:password@smtp.example.test" },
      { SMTP_HOST: "localhost\n" },
    ])
      expect(() => readConfig({ ...base, ...smtp, ...fields })).toThrow(
        "Invalid configuration fields",
      );
  });
});

describe("SMTP transport security and bounded outcomes", () => {
  let directory: string;
  let key: Buffer;
  let cert: Buffer;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "otto-smtp-"));
    const generated = Bun.spawnSync(
      [
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(directory, "key.pem"),
        "-out",
        join(directory, "cert.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(generated.exitCode).toBe(0);
    key = await readFile(join(directory, "key.pem"));
    cert = await readFile(join(directory, "cert.pem"));
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function client(
    port: number,
    fields: NodeJS.ProcessEnv = {},
    trust = true,
  ) {
    const process = Bun.spawn(
      [
        Bun.which("bun") ?? "bun",
        "--no-env-file",
        "tests/fixtures/smtp-client.ts",
      ],
      {
        env: {
          PATH: globalThis.process.env.PATH,
          ...smtp,
          SMTP_HOST: "localhost",
          SMTP_PORT: String(port),
          SMTP_USER: "fixture-user",
          SMTP_PASSWORD: "fixture-password",
          ...(trust
            ? { NODE_EXTRA_CA_CERTS: join(directory, "cert.pem") }
            : {}),
          ...fields,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    expect(stdout + stderr).not.toMatch(
      /fixture-user|fixture-password|Controlled SMTP content|private-fixture-token/,
    );
    return exitCode;
  }

  it.each(["tls", "starttls"] as const)(
    "authenticates only after verified %s and preserves the message",
    async (tls) => {
      let authenticated = 0;
      const sink = await startSmtp({
        serverOptions: {
          secure: tls === "tls",
          key,
          cert,
          disabledCommands: [],
          authOptional: false,
          onAuth(auth, session, callback) {
            expect(session.secure).toBe(true);
            expect(auth.username).toBe("fixture-user");
            expect(auth.password).toBe("fixture-password");
            authenticated++;
            callback(null, { user: auth.username });
          },
        },
      });
      try {
        expect(await client(sink.port, { SMTP_TLS: tls })).toBe(0);
        expect(authenticated).toBe(1);
        expect(sink.messages).toHaveLength(1);
        expect(sink.messages[0]).toMatchObject({
          to: [message.to],
          subject: message.subject,
          text: message.text,
        });
      } finally {
        await sink.close();
      }
    },
  );

  it.each(["tls", "starttls"] as const)(
    "refuses untrusted and wrong-host %s certificates before authentication",
    async (tls) => {
      let authenticated = 0;
      const sink = await startSmtp({
        onError: (error) => error.message === "socket hang up",
        serverOptions: {
          secure: tls === "tls",
          key,
          cert,
          disabledCommands: [],
          authOptional: false,
          onAuth(_auth, _session, callback) {
            authenticated++;
            callback(null, { user: "fixture" });
          },
        },
      });
      try {
        expect(await client(sink.port, { SMTP_TLS: tls }, false)).toBe(1);
        expect(
          await client(sink.port, { SMTP_TLS: tls, SMTP_HOST: "127.0.0.1" }),
        ).toBe(1);
        expect(authenticated).toBe(0);
        expect(sink.messages).toHaveLength(0);
      } finally {
        await sink.close();
      }
    },
  );

  it("refuses missing STARTTLS rather than disclosing credentials or delivering in plaintext", async () => {
    let authenticated = 0;
    const sink = await startSmtp({
      serverOptions: {
        disabledCommands: ["STARTTLS"],
        allowInsecureAuth: true,
        onAuth(_auth, _session, callback) {
          authenticated++;
          callback(null, { user: "fixture" });
        },
      },
    });
    try {
      expect(await client(sink.port)).toBe(1);
      expect(authenticated).toBe(0);
      expect(sink.messages).toHaveLength(0);
    } finally {
      await sink.close();
    }
  });

  it.each(["tls", "starttls"] as const)(
    "does not retry rejected %s authentication or silently send without AUTH",
    async (tls) => {
      for (const advertised of [true, false]) {
        let authenticated = 0;
        const sink = await startSmtp({
          serverOptions: {
            secure: tls === "tls",
            key,
            cert,
            disabledCommands: advertised ? [] : ["AUTH"],
            onAuth(_auth, _session, callback) {
              authenticated++;
              callback(new Error("private SMTP account detail"));
            },
          },
        });
        try {
          expect(await client(sink.port, { SMTP_TLS: tls })).toBe(1);
          expect(authenticated).toBe(advertised ? 1 : 0);
          expect(sink.messages).toHaveLength(0);
        } finally {
          await sink.close();
        }
      }
    },
  );

  it("redacts recipient/DATA failures without automatic retries or exposing the key", async () => {
    const sink = await startSmtp({
      onData: () => new Error("private SMTP provider detail"),
    });
    try {
      const mail = createSmtpMail({
        from: smtp.MAIL_FROM,
        host: sink.host,
        port: sink.port,
        tls: "none",
      });
      await expect(mail.send(message)).rejects.toThrow(
        /^Mail delivery uncertain$/,
      );
      expect(sink.messages).toHaveLength(1);
      expect(sink.messages[0]?.messageId).not.toContain(message.key);
    } finally {
      await sink.close();
    }
  });

  it.each(["tls", "starttls"] as const)(
    "bounds a stalled %s delivery after authentication and closes the upgraded socket",
    async (tls) => {
      let authenticated = 0;
      let closed = 0;
      const sink = await startSmtp({
        serverOptions: {
          secure: tls === "tls",
          key,
          cert,
          disabledCommands: [],
          authOptional: false,
          socketTimeout: 20000,
          onAuth(_auth, session, callback) {
            expect(session.secure).toBe(true);
            authenticated++;
            callback(null, { user: "fixture" });
          },
          onMailFrom() {},
          onClose() {
            closed++;
          },
        },
      });
      try {
        const started = performance.now();
        expect(await client(sink.port, { SMTP_TLS: tls })).toBe(1);
        expect(performance.now() - started).toBeLessThan(12000);
        expect(authenticated).toBe(1);
        await expect.poll(() => closed).toBe(1);
        expect(sink.messages).toHaveLength(0);
      } finally {
        await sink.close();
      }
    },
  );

  it("bounds a stalled or trickling greeting to ten seconds and closes each connection", async () => {
    const sockets = new Set<Socket>();
    let connections = 0;
    const server = createServer((socket) => {
      connections++;
      sockets.add(socket);
      const timer = setInterval(
        () => socket.write("220-still waiting\r\n"),
        1000,
      );
      socket.on("error", () => {});
      socket.on("close", () => {
        clearInterval(timer);
        sockets.delete(socket);
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing SMTP test port");
    try {
      const started = performance.now();
      await expect(
        createSmtpMail({
          from: smtp.MAIL_FROM,
          host: "127.0.0.1",
          port: address.port,
          tls: "none",
        }).send(message),
      ).rejects.toThrow(/^Mail delivery uncertain$/);
      expect(performance.now() - started).toBeLessThan(12000);
      await expect.poll(() => sockets.size).toBe(0);
      expect(connections).toBe(1);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
