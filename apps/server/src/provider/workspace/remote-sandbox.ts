import {
  type CommandResult,
  type ExecuteCommandOptions,
  MastraSandbox,
  type ProviderStatus,
} from "@mastra/core/workspace";
import { type OttoRemoteComputer, type RemoteBotSandbox } from "./bot-workspace-types.ts";

export class RemoteSandbox extends MastraSandbox {
  readonly name: string;
  readonly provider: string;
  readonly id: string;
  private readonly session: OttoRemoteComputer;
  status: ProviderStatus = "pending";
  constructor(id: string, provider: RemoteBotSandbox, session: OttoRemoteComputer) {
    super({ name: `Otto ${provider}` });
    this.id = id;
    this.name = `Otto ${provider}`;
    this.provider = provider;
    this.session = session;
  }
  // Starting connects only: the computer wakes on its first command, not when a chat opens.
  override async start() {
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
