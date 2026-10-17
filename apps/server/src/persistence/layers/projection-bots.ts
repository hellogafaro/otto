import {
  BotAlwaysAllowedTool,
  BotAvatar,
  BotEngine,
  ChannelBinding,
  LibraryFolderId,
  McpServerId,
  WorkParticipant,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../errors.ts";
import {
  GetProjectionBotInput,
  ProjectionBot,
  ProjectionBotRepository,
  type ProjectionBotRepositoryShape,
} from "../services/projection-bots.ts";

const ProjectionBotDbRow = ProjectionBot.mapFields(
  Struct.assign({
    avatar: Schema.fromJsonString(BotAvatar),
    engine: Schema.NullOr(Schema.fromJsonString(BotEngine)),
    disabledMcpServerIds: Schema.fromJsonString(Schema.Array(McpServerId)),
    disabledSkillIds: Schema.optional(Schema.fromJsonString(Schema.Array(LibraryFolderId))),
    alwaysAllowed: Schema.optional(Schema.fromJsonString(Schema.Array(BotAlwaysAllowedTool))),
    owner: Schema.NullOr(Schema.fromJsonString(WorkParticipant)),
    channelBindings: Schema.fromJsonString(Schema.Array(ChannelBinding)),
    voiceEnabled: Schema.Number,
  }),
);

function toProjectionBot(row: Schema.Schema.Type<typeof ProjectionBotDbRow>): ProjectionBot {
  return { ...row, voiceEnabled: row.voiceEnabled === 1 };
}

const makeProjectionBotRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertBotRow = SqlSchema.void({
    Request: ProjectionBot,
    execute: (row) => sql`
      INSERT INTO projection_bots (
        bot_id, name, title, label, description, instructions, disabled_mcp_server_ids_json,
        disabled_skill_ids_json, always_allowed_json, owner_json,
        avatar_json, engine_json, sandbox, runtime_mode, image_provider,
        voice_enabled, channel_bindings_json,
        group_id, archived_at, created_at, updated_at
      ) VALUES (
        ${row.botId}, ${row.name}, ${row.title}, ${row.label}, ${row.description},
        ${row.instructions},
        ${JSON.stringify(row.disabledMcpServerIds)}, ${JSON.stringify(row.disabledSkillIds ?? [])},
        ${JSON.stringify(row.alwaysAllowed ?? [])},
        ${row.owner ? JSON.stringify(row.owner) : null}, ${JSON.stringify(row.avatar)},
        ${row.engine === null ? null : JSON.stringify(row.engine)}, ${row.sandbox},
        ${row.runtimeMode}, ${row.imageProvider},
        ${row.voiceEnabled ? 1 : 0},
        ${JSON.stringify(row.channelBindings ?? [])}, ${row.groupId},
        ${row.archivedAt}, ${row.createdAt},
        ${row.updatedAt}
      )
      ON CONFLICT (bot_id) DO UPDATE SET
        name = excluded.name,
        title = excluded.title,
        label = excluded.label,
        description = excluded.description,
        instructions = excluded.instructions,
        disabled_mcp_server_ids_json = excluded.disabled_mcp_server_ids_json,
        disabled_skill_ids_json = excluded.disabled_skill_ids_json,
        always_allowed_json = excluded.always_allowed_json,
        owner_json = excluded.owner_json,
        avatar_json = excluded.avatar_json,
        engine_json = excluded.engine_json,
        sandbox = excluded.sandbox,
        runtime_mode = excluded.runtime_mode,
        image_provider = excluded.image_provider,
        voice_enabled = excluded.voice_enabled,
        channel_bindings_json = excluded.channel_bindings_json,
        group_id = excluded.group_id,
        archived_at = excluded.archived_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
  });

  const getBotRow = SqlSchema.findOneOption({
    Request: GetProjectionBotInput,
    Result: ProjectionBotDbRow,
    execute: ({ botId }) => sql`
      SELECT
        bot_id AS "botId", name, title, label, description, instructions,
        disabled_mcp_server_ids_json AS "disabledMcpServerIds", disabled_skill_ids_json AS "disabledSkillIds", always_allowed_json AS "alwaysAllowed", owner_json AS "owner", avatar_json AS "avatar",
        engine_json AS "engine", sandbox, runtime_mode AS "runtimeMode",
        image_provider AS "imageProvider", voice_enabled AS "voiceEnabled",
        channel_bindings_json AS "channelBindings", group_id AS "groupId",
        archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM projection_bots
      WHERE bot_id = ${botId}
    `,
  });

  const listBotRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionBotDbRow,
    execute: () => sql`
      SELECT
        bot_id AS "botId", name, title, label, description, instructions,
        disabled_mcp_server_ids_json AS "disabledMcpServerIds", disabled_skill_ids_json AS "disabledSkillIds", always_allowed_json AS "alwaysAllowed", owner_json AS "owner", avatar_json AS "avatar",
        engine_json AS "engine", sandbox, runtime_mode AS "runtimeMode",
        image_provider AS "imageProvider", voice_enabled AS "voiceEnabled",
        channel_bindings_json AS "channelBindings", group_id AS "groupId",
        archived_at AS "archivedAt", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM projection_bots
      ORDER BY created_at ASC, bot_id ASC
    `,
  });

  const deleteBotRow = SqlSchema.void({
    Request: GetProjectionBotInput,
    execute: ({ botId }) => sql`DELETE FROM projection_bots WHERE bot_id = ${botId}`,
  });

  const upsert: ProjectionBotRepositoryShape["upsert"] = (row) =>
    upsertBotRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionBotRepository.upsert:query")),
    );

  const getById: ProjectionBotRepositoryShape["getById"] = (input) =>
    getBotRow(input).pipe(
      Effect.map(Option.map(toProjectionBot)),
      Effect.mapError(toPersistenceSqlError("ProjectionBotRepository.getById:query")),
    );

  const listAll: ProjectionBotRepositoryShape["listAll"] = () =>
    listBotRows(undefined).pipe(
      Effect.map((rows) => rows.map(toProjectionBot)),
      Effect.mapError(toPersistenceSqlError("ProjectionBotRepository.listAll:query")),
    );

  const deleteById: ProjectionBotRepositoryShape["deleteById"] = (input) =>
    deleteBotRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionBotRepository.deleteById:query")),
    );

  return { upsert, getById, listAll, deleteById } satisfies ProjectionBotRepositoryShape;
});

export const ProjectionBotRepositoryLive = Layer.effect(
  ProjectionBotRepository,
  makeProjectionBotRepository,
);
