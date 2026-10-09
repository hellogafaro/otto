import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { readConfig } from "../apps/server/src/config";

const root = resolve(import.meta.dirname, "..");
const state = resolve(homedir(), ".capy/work/otto-v1-durable");
const postgres = "/opt/homebrew/opt/postgresql@17/bin";
const socket = resolve(state, "socket");
const database = `postgresql://otto_dev@/otto_dev?host=${encodeURIComponent(socket)}&port=55437`;
const garage = "otto-v1-durable-garage";
const image =
  "dxflrs/garage@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020";
const environment: Record<string, string> = {
  HOME: homedir(),
  PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
  LC_ALL: "C",
};

async function capture(command: string[]) {
  const child = Bun.spawn(command, {
    cwd: root,
    env: environment,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30000,
  });
  const [output, , exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error("Local service inspection failed");
  return output.trim();
}

async function run(command: string[], env = environment) {
  const child = Bun.spawn(command, {
    cwd: root,
    env,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    process.exitCode = await child.exited;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

try {
  if (!Bun.semver.satisfies(Bun.version, ">=1.4.2"))
    throw new Error("Bun 1.4.2 or later is required");
  if ((await Bun.file(resolve(root, "package.json")).json()).name !== "otto")
    throw new Error("Expected the assigned Otto repository");
  switch (process.argv[2]) {
    case "postgres": {
      if (!(await Bun.file(resolve(state, "pg/PG_VERSION")).exists()))
        throw new Error("Durable PostgreSQL has not been provisioned");
      const status = Bun.spawnSync(
        [
          "/opt/homebrew/opt/postgresql@17/bin/pg_ctl",
          "-D",
          resolve(state, "pg"),
          "status",
        ],
        {
          cwd: root,
          env: environment,
          stdout: "ignore",
          stderr: "ignore",
          timeout: 5000,
        },
      );
      if (status.exitCode === 0) {
        console.log("Owned durable PostgreSQL is already running");
        break;
      }
      if (status.exitCode !== 3)
        throw new Error("Cannot establish owned PostgreSQL status");
      await run([
        `${postgres}/postgres`,
        "-D",
        resolve(state, "pg"),
        "-k",
        socket,
        "-p",
        "55437",
        "-h",
        "",
        "-c",
        "unix_socket_permissions=0700",
      ]);
      break;
    }
    case "schema": {
      await run([process.execPath, "--no-env-file", "scripts/push.ts"], {
        ...environment,
        DATABASE_URL: database,
      });
      break;
    }
    case "garage": {
      const network = await capture([
        "docker",
        "network",
        "inspect",
        "otto-v1-durable",
        "--format",
        '{{.Internal}} {{index .Labels "io.otto.purpose"}}',
      ]);
      if (network !== "true durable-local-dev")
        throw new Error("Expected the owned private Garage network");
      const existing = await capture([
        "docker",
        "container",
        "ls",
        "--all",
        "--filter",
        `name=^/${garage}$`,
        "--format",
        "{{.Names}}",
      ]);
      if (existing) {
        if (existing !== garage) throw new Error("Unexpected container match");
        const [purpose, configuredImage, command, mounts, ports, networks] = (
          await capture([
            "docker",
            "inspect",
            "--format",
            '{{index .Config.Labels "io.otto.purpose"}}\n{{.Config.Image}}\n{{json .Config.Cmd}}\n{{json .Mounts}}\n{{json .HostConfig.PortBindings}}\n{{json .NetworkSettings.Networks}}',
            garage,
          ])
        ).split("\n");
        const bindings = JSON.parse(ports ?? "null");
        const attachedNetworks = JSON.parse(networks ?? "null");
        const mounted = JSON.parse(mounts ?? "null") as {
          Type: string;
          Source: string;
          Destination: string;
          RW: boolean;
        }[];
        if (
          purpose !== "durable-local-dev" ||
          configuredImage !== image ||
          command !== '["/garage","server"]' ||
          !Array.isArray(mounted) ||
          mounted.length !== 3 ||
          ![
            [resolve(root, "ops/local-garage.toml"), "/etc/garage.toml", false],
            [resolve(state, "garage-meta"), "/var/lib/garage/meta", true],
            [resolve(state, "garage-data"), "/var/lib/garage/data", true],
          ].every(([source, destination, writable]) =>
            mounted.some(
              (mount) =>
                mount.Type === "bind" &&
                mount.Source === source &&
                mount.Destination === destination &&
                mount.RW === writable,
            ),
          ) ||
          JSON.stringify(bindings) !==
            '{"3900/tcp":[{"HostIp":"127.0.0.1","HostPort":"43900"}]}' ||
          Object.keys(attachedNetworks ?? {}).join() !== "otto-v1-durable"
        )
          throw new Error(
            "Existing container does not match owned configuration",
          );
        await run(["docker", "start", garage]);
        break;
      }
      const secret = process.env.GARAGE_RPC_SECRET;
      if (!secret || !/^[0-9a-f]{64}$/i.test(secret))
        throw new Error("Invalid GARAGE_RPC_SECRET");
      for (const directory of ["garage-meta", "garage-data"])
        await mkdir(resolve(state, directory), {
          recursive: true,
          mode: 0o700,
        });
      await run(
        [
          "docker",
          "run",
          "--detach",
          "--name",
          garage,
          "--label",
          "io.otto.purpose=durable-local-dev",
          "--restart",
          "unless-stopped",
          "--network",
          "otto-v1-durable",
          "--publish",
          "127.0.0.1:43900:3900",
          "--env",
          "GARAGE_RPC_SECRET",
          "--mount",
          `type=bind,src=${resolve(root, "ops/local-garage.toml")},dst=/etc/garage.toml,readonly`,
          "--mount",
          `type=bind,src=${resolve(state, "garage-meta")},dst=/var/lib/garage/meta`,
          "--mount",
          `type=bind,src=${resolve(state, "garage-data")},dst=/var/lib/garage/data`,
          image,
          "/garage",
          "server",
        ],
        { ...environment, GARAGE_RPC_SECRET: secret },
      );
      break;
    }
    case "server": {
      const supplied = process.env.ENCRYPTION_KEY;
      const encryptionKey =
        supplied && /^[0-9a-f]{64}$/i.test(supplied)
          ? Buffer.from(supplied, "hex").toString("base64")
          : supplied;
      const env: NodeJS.ProcessEnv = {
        ...environment,
        DATABASE_URL: database,
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
        ENCRYPTION_KEY: encryptionKey,
        OTTO_ORIGIN: "http://localhost:5173",
        HOST: "127.0.0.1",
        PORT: "45175",
        S3_ENDPOINT: "http://127.0.0.1:43900",
        S3_REGION: "garage",
        S3_BUCKET: "otto-dev",
        S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
        S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
        MAIL_FROM: process.env.MAIL_FROM,
        RESEND_API_KEY: process.env.RESEND_API_KEY,
      };
      readConfig(env);
      await run(
        [process.execPath, "--no-env-file", "apps/server/src/index.ts"],
        Object.fromEntries(
          Object.entries(env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
      );
      break;
    }
    default:
      throw new Error("Choose postgres, schema, garage, or server");
  }
} catch {
  console.error("Durable local service failed; no secret values were logged");
  process.exitCode = 1;
}
