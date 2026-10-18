import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** Whether bots remember what comes up in chats. */
export const MemorySettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
}).pipe(Schema.withDecodingDefault(Effect.succeed({})));

export type MemorySettings = typeof MemorySettings.Type;

export const MemorySettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
});

export type MemorySettingsPatch = typeof MemorySettingsPatch.Type;
