import {
  AuthSessionId,
  BotId,
  CommandId,
  LIBRARY_SKILLS_FOLDER_ID,
  LibraryFolderId,
  McpServerId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type WorkParticipant,
} from "@otto/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";
import { makeChannelTestBot } from "../server-test-fixtures.ts";

const later = "2026-10-19T22:00:00.000Z";
const earlier = "2026-01-01T00:00:00.000Z";

const ada: WorkParticipant = {
  kind: "person",
  personId: AuthSessionId.make("ada"),
  displayName: "Ada",
};

const apply = (readModel: OrchestrationReadModel, command: OrchestrationCommand) =>
  Effect.gen(function* () {
    const result = yield* decideOrchestrationCommand({ command, readModel });
    const planned = Array.isArray(result) ? result : [result];
    let next = readModel;

    for (const event of planned) {
      next = yield* projectEvent(next, {
        ...event,
        sequence: next.snapshotSequence + 1,
      } as OrchestrationEvent);
    }

    return next;
  });

const scout = {
  ...makeChannelTestBot(),
  id: BotId.make("scout"),
  name: "Scout",
};

it.layer(NodeServices.layer)("added tools start off", (it) => {
  it.effect("switches a new team or private skill and MCP off, and leaves older ones on", () =>
    Effect.gen(function* () {
      const withBot = {
        ...createEmptyReadModel(earlier),
        bots: [scout],
      };
      const skills = yield* apply(withBot, {
        type: "library.folder.create",
        commandId: CommandId.make("cmd-skills"),
        folderId: LIBRARY_SKILLS_FOLDER_ID,
        parentId: null,
        title: "Skills",
        by: ada,
        createdAt: earlier,
      });
      const oldSkill = yield* apply(skills, {
        type: "library.folder.create",
        commandId: CommandId.make("cmd-old-skill"),
        folderId: LibraryFolderId.make("old-skill"),
        parentId: LIBRARY_SKILLS_FOLDER_ID,
        title: "Old",
        visibility: "organization",
        by: ada,
        createdAt: earlier,
      });

      expect(oldSkill.bots[0]?.disabledSkillIds).toBeUndefined();

      const teamSkill = yield* apply(oldSkill, {
        type: "library.folder.create",
        commandId: CommandId.make("cmd-team-skill"),
        folderId: LibraryFolderId.make("team-skill"),
        parentId: LIBRARY_SKILLS_FOLDER_ID,
        title: "Team",
        visibility: "organization",
        by: ada,
        createdAt: later,
      });
      const privateSkill = yield* apply(teamSkill, {
        type: "library.folder.create",
        commandId: CommandId.make("cmd-private-skill"),
        folderId: LibraryFolderId.make("private-skill"),
        parentId: LIBRARY_SKILLS_FOLDER_ID,
        title: "Private",
        visibility: "user",
        by: ada,
        createdAt: later,
      });

      expect(privateSkill.bots[0]?.disabledSkillIds).toEqual(["team-skill", "private-skill"]);

      const oldServer = yield* apply(privateSkill, {
        type: "mcp-server.create",
        commandId: CommandId.make("cmd-old-mcp"),
        mcpServerId: McpServerId.make("mcp-old"),
        name: "Old",
        transport: "url",
        url: "https://mcp.example.com/old",
        visibility: "organization",
        by: ada,
        createdAt: earlier,
      });

      expect(oldServer.bots[0]?.disabledMcpServerIds).toEqual([]);

      const teamServer = yield* apply(oldServer, {
        type: "mcp-server.create",
        commandId: CommandId.make("cmd-team-mcp"),
        mcpServerId: McpServerId.make("mcp-team"),
        name: "Team",
        transport: "url",
        url: "https://mcp.example.com/team",
        visibility: "organization",
        by: ada,
        createdAt: later,
      });
      const privateServer = yield* apply(teamServer, {
        type: "mcp-server.create",
        commandId: CommandId.make("cmd-private-mcp"),
        mcpServerId: McpServerId.make("mcp-private"),
        name: "Private",
        transport: "url",
        url: "https://mcp.example.com/private",
        visibility: "user",
        by: ada,
        createdAt: later,
      });

      expect(privateServer.bots[0]?.disabledMcpServerIds).toEqual(["mcp-team", "mcp-private"]);

      const created = yield* apply(privateServer, {
        type: "bot.create",
        commandId: CommandId.make("cmd-nova"),
        botId: BotId.make("nova"),
        name: "Nova",
        title: "Nova",
        avatar: { kind: "dither", seed: "nova" },
        engine: null,
        sandbox: "local",
        groupId: null,
        createdAt: later,
      });
      const nova = created.bots.find((bot) => bot.id === "nova");

      expect(nova?.disabledSkillIds).toEqual(["team-skill", "private-skill"]);
      expect(nova?.disabledMcpServerIds).toEqual(["mcp-team", "mcp-private"]);
      expect(nova?.disabledSkillIds).not.toContain("old-skill");
      expect(nova?.disabledMcpServerIds).not.toContain("mcp-old");
    }),
  );
});
