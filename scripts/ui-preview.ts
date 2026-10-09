import { startUiApp } from "../tests/fixtures/ui-app";

// Disposable local preview only. Production signup, secrets and storage configuration are unchanged.
const origin = process.env.OTTO_UI_ORIGIN ?? "http://127.0.0.1:45173";
const fixture = await startUiApp(origin, 45175);
const web = Bun.spawn(
  [
    process.execPath,
    "--bun",
    "run",
    "--cwd",
    "apps/web",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    "45173",
    "--strictPort",
  ],
  {
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
      OTTO_API_ORIGIN: fixture.apiOrigin,
      OTTO_UI_ORIGIN: origin,
    },
  },
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  web.kill("SIGTERM");
  await web.exited;
  await fixture.stop();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
void web.exited.then(() => {
  if (!stopping) void stop();
});
console.log(
  JSON.stringify({
    status: "ready",
    origin,
    storage: "controlled disk S3 peer",
    execution: "compute unavailable",
  }),
);
// Operator-only fixture enrollment through this process's stdin; never an HTTP setup endpoint.
for await (const line of console) {
  try {
    const input: unknown = JSON.parse(line);
    if (
      !input ||
      typeof input !== "object" ||
      !("userId" in input) ||
      typeof input.userId !== "string"
    )
      throw new Error("Invalid fixture command");
    if ("secondWorkspace" in input && input.secondWorkspace === true)
      console.log(
        JSON.stringify({
          workspaceId: await fixture.secondWorkspace(input.userId),
        }),
      );
    else {
      const role =
        "role" in input &&
        (input.role === "viewer" || input.role === "contributor")
          ? input.role
          : "owner";
      console.log(
        JSON.stringify({
          workspaceId: await fixture.grant(input.userId, role),
        }),
      );
    }
  } catch {
    console.log(JSON.stringify({ error: "fixture enrollment failed" }));
  }
}
await stop();
