import {
  type CommandResult,
  type ExecuteCommandOptions,
  MastraSandbox,
  type ProviderStatus,
} from "@mastra/core/workspace";
import { type OttoRemoteSession, type RemoteBotSandbox } from "./bot-workspace-types.ts";

export class RemoteSandbox extends MastraSandbox {
  readonly name: string;
  readonly provider: string;
  readonly id: string;
  private readonly session: OttoRemoteSession;
  status: ProviderStatus = "pending";
  constructor(id: string, provider: RemoteBotSandbox, session: OttoRemoteSession) {
    super({ name: `Otto ${provider}` });
    this.id = id;
    this.name = `Otto ${provider}`;
    this.provider = provider;
    this.session = session;
  }
  override async start() {
    await this.session.wake();

    return { outcome: "connected" as const };
  }
  override stop() {
    return this.session.sleep();
  }
  override destroy() {
    return this.session.destroy();
  }
  override async executeCommand(
    command: string,
    args: string[] = [],
    options?: ExecuteCommandOptions,
  ): Promise<CommandResult> {
    const startedAt = performance.now();

    const env = options?.env
      ? Object.fromEntries(
          Object.entries(options.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        )
      : undefined;

    const result = await this.session.run(command, args, {
      ...(options?.cwd ? { cwd: options.cwd } : {}),
      ...(env ? { env } : {}),
      ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
    });

    return {
      ...result,
      success: result.exitCode === 0,
      executionTimeMs: performance.now() - startedAt,
    };
  }
}
