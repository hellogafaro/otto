import { z } from "zod";
import { startNativeTestApp } from "../tests/fixtures/native-app";

const command = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("enroll"),
      userId: z.string().min(1).max(128),
      role: z.enum(["owner", "contributor", "viewer"]).default("owner"),
    })
    .strict(),
  z.object({ type: z.literal("restart") }).strict(),
  z.object({ type: z.literal("stop") }).strict(),
]);

let fixture: Awaited<ReturnType<typeof startNativeTestApp>> | undefined;
let startup: ReturnType<typeof startNativeTestApp> | undefined;
let stopping: Promise<void> | undefined;
function stop() {
  stopping ??= (async () => {
    const current = fixture ?? (await startup?.catch(() => undefined));
    await current?.stop();
  })();
  return stopping;
}
process.on(
  "SIGTERM",
  () =>
    void stop().then(
      () => process.exit(0),
      () => process.exit(1),
    ),
);
process.on(
  "SIGINT",
  () =>
    void stop().then(
      () => process.exit(0),
      () => process.exit(1),
    ),
);

try {
  startup = startNativeTestApp({
    origin: process.env.OTTO_UI_ORIGIN ?? "http://127.0.0.1:5173",
    port: Number(process.env.PORT ?? 45175),
  });
  fixture = await startup;
  console.log(
    JSON.stringify({
      status: "ready",
      origin: fixture.origin,
      apiOrigin: fixture.apiOrigin,
      storage: "disposable loopback S3 peer",
      enrollment: "operator stdin only",
    }),
  );
  for await (const line of console) {
    try {
      const input = command.parse(JSON.parse(line));
      if (input.type === "stop") {
        await stop();
        break;
      }
      if (input.type === "restart") {
        await fixture.restart();
        console.log(
          JSON.stringify({ status: "restarted", apiOrigin: fixture.apiOrigin }),
        );
      } else {
        console.log(
          JSON.stringify({
            workspaceId: await fixture.grant(input.userId, input.role),
            status: "enrolled",
          }),
        );
      }
    } catch {
      console.log(JSON.stringify({ error: "Fixture command failed" }));
    }
  }
  if (!stopping) await new Promise<void>(() => {});
} catch {
  console.error("Native development fixture failed");
  process.exitCode = 1;
} finally {
  try {
    await stop();
  } catch {
    console.error("Native development fixture cleanup failed");
    process.exitCode = 1;
  }
}
