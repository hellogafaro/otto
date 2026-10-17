import {
  BotAlwaysAllowedTool,
  BotAvatar,
  BotEngine,
  BotId,
  ImageProviderId,
  PersistedBotSandbox,
  ChannelBinding,
  GroupId,
  IsoDateTime,
  McpServerId,
  RuntimeMode,
  WorkParticipant,
  LibraryFolderId,
} from "@otto/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../errors.ts";

export const ProjectionBot = Schema.Struct({
  botId: BotId,
  name: Schema.String,
  title: Schema.String,
  label: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  instructions: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  disabledMcpServerIds: Schema.Array(McpServerId),
  disabledSkillIds: Schema.optional(Schema.Array(LibraryFolderId)),
  alwaysAllowed: Schema.optional(Schema.Array(BotAlwaysAllowedTool)),
  owner: Schema.optional(Schema.NullOr(WorkParticipant)),
  avatar: BotAvatar,
  engine: Schema.NullOr(BotEngine),
  sandbox: PersistedBotSandbox,
  runtimeMode: RuntimeMode,
  imageProvider: Schema.NullOr(ImageProviderId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  voiceEnabled: Schema.Boolean,
  channelBindings: Schema.optional(Schema.Array(ChannelBinding)),
  groupId: Schema.NullOr(GroupId),
  archivedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export type ProjectionBot = typeof ProjectionBot.Type;

export const GetProjectionBotInput = Schema.Struct({ botId: BotId });

export type GetProjectionBotInput = typeof GetProjectionBotInput.Type;

export interface ProjectionBotRepositoryShape {
  readonly upsert: (bot: ProjectionBot) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionBotInput,
  ) => Effect.Effect<Option.Option<ProjectionBot>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<ReadonlyArray<ProjectionBot>, ProjectionRepositoryError>;
  readonly deleteById: (
    input: GetProjectionBotInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionBotRepository extends Context.Service<
  ProjectionBotRepository,
  ProjectionBotRepositoryShape
>()("@otto/server/persistence/services/projection-bots/ProjectionBotRepository") {}
