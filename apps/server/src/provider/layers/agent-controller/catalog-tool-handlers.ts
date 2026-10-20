import * as NodeBuffer from "node:buffer";
import * as NodeCrypto from "node:crypto";
import type { Workspace } from "@mastra/core/workspace";
import { type BotId, CommandId, McpServerId, type ThreadId } from "@otto/contracts";
import * as Predicate from "effect/Predicate";
import {
  activeAudioTranscriber,
  AUDIO_LIBRARY_MAX_BYTES,
  type AudioComputer,
  transcribeAudioFile,
} from "../../../voice-call/audio-transcribe-tool.ts";
import { runImageGenerationTool } from "../../../image-generation/image-generation-runtime.ts";
import { activeLibraryTools } from "../../../library/library-tool-runtime.ts";
import { activeTaskTools } from "../../../tasks/task-tool-runtime.ts";
import { createOttoCatalogToolHandlers } from "../../otto-catalog-tool-handlers.ts";
import { ottoWebSearchUnavailable } from "../../otto-web-fetch.ts";
import { nowIso } from "./event-identity.ts";
import { createSessionSearch } from "./search-tool.ts";
import { mcpServerDependentBots } from "./mcp-configuration.ts";
import type { SessionLifecycleDependencies } from "./session-lifecycle-dependencies.ts";

/** Base64 the remote computer's file API takes in one command, about 64 KB. */
const COMPUTER_WRITE_PIECE_BYTES = 48 * 1024;

/** The bot's computer as audio_transcribe uses it: commands, and binary file reads and writes. */
function audioComputer(workspace: Workspace | undefined): AudioComputer | undefined {
  const sandbox = workspace?.sandbox;
  const filesystem = workspace?.filesystem;

  if (!sandbox?.executeCommand || !filesystem) return undefined;
  const run = sandbox.executeCommand.bind(sandbox);

  return {
    run: async (command) => {
      const result = await run(command, [], { timeout: 600_000 });

      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    },
    readFile: async (path) => NodeBuffer.Buffer.from(await filesystem.readFile(path)),
    // A remote computer writes through one shell command per call, so large files go in pieces.
    writeFile: async (path, content) => {
      const bytes = NodeBuffer.Buffer.from(content);
      await filesystem.writeFile(path, bytes.subarray(0, COMPUTER_WRITE_PIECE_BYTES));

      for (
        let offset = COMPUTER_WRITE_PIECE_BYTES;
        offset < bytes.byteLength;
        offset += COMPUTER_WRITE_PIECE_BYTES
      ) {
        await filesystem.appendFile(
          path,
          bytes.subarray(offset, offset + COMPUTER_WRITE_PIECE_BYTES),
        );
      }
    },
  };
}

/**
 * Catalog tool handlers for one bot session: MCP request health and inbox
 * incidents, image generation, transcription, and the catalog MCP server management tools.
 */
export function createSessionCatalogHandlers(
  deps: SessionLifecycleDependencies,
  input: {
    readonly threadId: ThreadId;
    readonly botId: BotId | undefined;
    readonly botName: string | undefined;
    readonly mcpManager: ReturnType<
      SessionLifecycleDependencies["sessionResources"]["getMcpManager"]
    >;
    readonly workspace?: Workspace | undefined;
  },
) {
  const { threadId, mcpManager } = input;
  const libraryTools = activeLibraryTools();
  const libraryCaller = input.botId ? { threadId, botId: input.botId } : null;
  const taskTools = activeTaskTools();
  const transcriber = activeAudioTranscriber();

  const mcpDependencies =
    input.botId && input.botName
      ? { dependentBots: [{ id: input.botId, name: input.botName }], dependentRoutines: [] }
      : { dependentBots: [], dependentRoutines: [] };

  return createOttoCatalogToolHandlers(
    mcpManager,
    deps.wired().pluginRuntime,
    mcpManager
      ? {
          getRequestHealth: (serverId) => deps.subscriptionAuth.mcpRequestHealth(serverId),
          recordSuccess: (serverId, at) =>
            deps.subscriptionAuth.recordMcpRequestSuccess(serverId, at),
          recordFailure: (serverId, message, at) =>
            deps.subscriptionAuth.recordMcpRequestFailure(serverId, message, at),
          getDependencies: async (serverId) => {
            const snapshot = await deps.wired().pluginRuntimeOptions?.readSnapshot();

            return snapshot
              ? {
                  dependentBots: mcpServerDependentBots(snapshot, serverId),
                  dependentRoutines: [],
                }
              : mcpDependencies;
          },
          onFailure: (serverId, message, dependencies) => {
            for (const bot of dependencies.dependentBots) {
              deps.botInbox.ensureOpen({
                incidentKey: `access:mcp-${serverId}:${bot.id}`,
                kind: "connector-failure",
                botId: bot.id,
                botName: bot.name,
                taskOrRoutine: `${serverId} access`,
                lastFailure: message,
                nextAction: `Reconnect ${serverId}, then retry its failed request.`,
              });
            }
          },
          onRecovery: (serverId, dependencies) => {
            for (const bot of dependencies.dependentBots) {
              deps.botInbox.resolve(`access:mcp-${serverId}:${bot.id}`);
            }
          },
        }
      : undefined,
    {
      webSearch: ottoWebSearchUnavailable,
      webFetch: deps.webFetch,
      // The router bounds each provider attempt and interruptTurn cancels
      // in-flight requests, so there is no outer deadline here.
      ...(input.botId
        ? {
            botId: input.botId,
            search: createSessionSearch(deps, { threadId, botId: input.botId }),
          }
        : {}),
      generateImage: async (request) => {
        const generate = deps.options?.generateImage ?? runImageGenerationTool;

        return deps.runPromise(generate(threadId, request));
      },
      ...(transcriber
        ? {
            transcribeAudio: (request, signal) =>
              transcribeAudioFile(request, {
                computer: audioComputer(input.workspace),
                library:
                  libraryTools && libraryCaller
                    ? {
                        read: async (fileId) => {
                          const file = await deps.runPromise(
                            libraryTools.readBytes(libraryCaller, fileId, AUDIO_LIBRARY_MAX_BYTES),
                          );

                          if (Predicate.hasProperty(file, "error")) throw new Error(file.error);

                          return file;
                        },
                        save: async (file) => {
                          const saved = await deps.runPromise(
                            libraryTools.save(libraryCaller, file),
                          );

                          if (Predicate.hasProperty(saved, "error")) throw new Error(saved.error);

                          return saved.fileId;
                        },
                      }
                    : undefined,
                transcribe: transcriber,
                signal,
              }),
          }
        : {}),
      ...(libraryTools && libraryCaller
        ? {
            library: {
              save: (request) => deps.runPromise(libraryTools.save(libraryCaller, request)),
              read: (request) => deps.runPromise(libraryTools.read(libraryCaller, request)),
              updateDocument: (request) =>
                deps.runPromise(libraryTools.updateDocument(libraryCaller, request)),
              share: (request) => deps.runPromise(libraryTools.share(libraryCaller, request)),
              unshare: (request) => deps.runPromise(libraryTools.unshare(libraryCaller, request)),
              readSkillFile: (request) =>
                deps.runPromise(libraryTools.readSkillFile(libraryCaller, request)),
              proposeSkill: (request, responder) =>
                deps.runPromise(libraryTools.proposeSkill(libraryCaller, request, responder)),
              updateSkill: (request, responder) =>
                deps.runPromise(libraryTools.updateSkill(libraryCaller, request, responder)),
            },
          }
        : {}),
      ...(taskTools && libraryCaller
        ? {
            tasks: {
              task_read: (request) => deps.runPromise(taskTools.read(libraryCaller, request)),
              task_create: (request) => deps.runPromise(taskTools.create(libraryCaller, request)),
              task_update: (request) => deps.runPromise(taskTools.update(libraryCaller, request)),
              task_delete: (request) => deps.runPromise(taskTools.delete(libraryCaller, request)),
              task_comment_create: (request) =>
                deps.runPromise(taskTools.createComment(libraryCaller, request)),
              task_comment_list: (request) =>
                deps.runPromise(taskTools.listComments(libraryCaller, request)),
              task_comment_update: (request) =>
                deps.runPromise(taskTools.updateComment(libraryCaller, request)),
              task_comment_delete: (request) =>
                deps.runPromise(taskTools.deleteComment(libraryCaller, request)),
              task_time_create: (request) =>
                deps.runPromise(taskTools.createTime(libraryCaller, request)),
              task_time_delete: (request) =>
                deps.runPromise(taskTools.deleteTime(libraryCaller, request)),
              task_time_list: (request) =>
                deps.runPromise(taskTools.listTime(libraryCaller, request)),
            },
          }
        : {}),
      ...(deps.wired().pluginRuntimeOptions
        ? {
            addMcpServer: async ({ url, title }) => {
              const slug = title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .slice(0, 40);

              const serverId = McpServerId.make(
                `${slug || "mcp"}-${NodeCrypto.randomUUID().slice(0, 6)}`,
              );

              await deps.wired().pluginRuntimeOptions!.dispatch({
                type: "mcp-server.create",
                commandId: CommandId.make(`catalog:mcp-add:${NodeCrypto.randomUUID()}`),
                mcpServerId: serverId,
                name: title,
                transport: "url",
                url,
                enabled: true,
                createdAt: nowIso(),
              });

              return {
                serverId,
                added: true,
                next: "Check it with connection_check; sign in with action authenticate if it asks.",
              };
            },
            uninstallMcpServer: (serverId: string) =>
              deps.deleteCatalogMcpServer(
                deps.wired().pluginRuntimeOptions!,
                serverId,
                "mcp-delete",
              ),
            renameMcpAccount: async (value) => {
              const server = (
                await deps.wired().pluginRuntimeOptions!.readSnapshot()
              ).mcpServers?.find((candidate) => candidate.id === value.serverId);

              if (!server) throw new Error(`MCP server '${value.serverId}' was not found.`);

              const base = {
                type: "mcp-server.update" as const,
                commandId: CommandId.make(`catalog:mcp-rename:${NodeCrypto.randomUUID()}`),
                mcpServerId: server.id,
                name: value.name,
              };

              await deps.wired().pluginRuntimeOptions!.dispatch(
                server.transport === "stdio"
                  ? {
                      ...base,
                      transport: "stdio",
                      command: server.command,
                      ...(server.args ? { args: [...server.args] } : {}),
                    }
                  : { ...base, transport: "url", url: server.url },
              );

              return { serverId: value.serverId, name: value.name, renamed: true };
            },
            setMcpInstructions: async (value: {
              readonly serverId: string;
              readonly instructions: string;
            }) => {
              await deps.wired().pluginRuntimeOptions!.dispatch({
                type: "mcp-server.instructions.set",
                commandId: CommandId.make(`catalog:mcp-instructions:${NodeCrypto.randomUUID()}`),
                mcpServerId: McpServerId.make(value.serverId),
                instructions: value.instructions,
              });

              return {
                serverId: value.serverId,
                instructions: value.instructions.trim(),
                appliesFrom: "next-turn",
              };
            },
          }
        : {}),
    },
  );
}
