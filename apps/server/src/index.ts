import { readConfig } from "./config";
import { createConnectionOptions } from "./connection-config";
import { startServer } from "./lifecycle";
import { createLogger } from "./logger";

const logger = createLogger();
let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
let stopping = false;
let startup: Promise<void>;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => {
    logger.error("shutdown deadline exceeded");
    process.exit(1);
  }, 25000);
  try {
    await startup;
    await runtime?.stop();
  } catch {
    process.exitCode = 1;
    logger.error("shutdown failed");
  } finally {
    clearTimeout(deadline);
  }
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
startup = (async () => {
  try {
    // The config parser exposes only field names; never print raw exceptions.
    let config: ReturnType<typeof readConfig>;
    let connections: ReturnType<typeof createConnectionOptions>;
    try {
      config = readConfig(process.env);
      connections = createConnectionOptions(config, process.env);
    } catch (error) {
      logger.error(
        { fields: error instanceof Error ? error.message : "invalid" },
        "configuration rejected",
      );
      process.exitCode = 1;
      return;
    }
    runtime = await startServer(config, {
      connections,
      computer:
        config.COMPUTER_DOCKER_IMAGE &&
        config.COMPUTER_DOCKER_SOCKET &&
        config.COMPUTER_OWNER_ID
          ? {
              image: config.COMPUTER_DOCKER_IMAGE,
              socketPath: config.COMPUTER_DOCKER_SOCKET,
              ownerId: config.COMPUTER_OWNER_ID,
            }
          : undefined,
    });
  } catch {
    logger.error("server startup failed");
    process.exitCode = 1;
  }
})();
await startup;
