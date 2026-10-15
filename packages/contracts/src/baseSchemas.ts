import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

export const TrimmedString = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transformOrFail({
      decode: (value) => Effect.succeed(value.trim()),
      encode: (value) => Effect.succeed(value.trim()),
    }),
  ),
);

export const TrimmedNonEmptyString = TrimmedString.check(Schema.isNonEmpty());

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const PortSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

export const IsoDateTime = Schema.String;

export type IsoDateTime = typeof IsoDateTime.Type;

/**
 * Wire codec for server→client arrays whose element unions grow over time
 * (new literal members, new struct variants). Decoding drops elements the
 * current build cannot decode instead of failing the whole payload — a client
 * has to keep decoding configs sent by servers newer than itself, and
 * rejecting the payload would take down the connection over data the client
 * couldn't act on anyway. Encoding is the plain array encoding.
 */
export const ForwardCompatibleArray = <Element extends Schema.Top>(element: Element) => {
  // SAFETY: Wire element schemas are context-free codecs; Schema.Top erases their decoding service requirement.
  const decodeElement = Schema.decodeUnknownOption(element as never);

  return Schema.Array(Schema.Unknown).pipe(
    Schema.decodeTo(
      Schema.Array(element),
      SchemaTransformation.transform<ReadonlyArray<Element["Encoded"]>, ReadonlyArray<unknown>>({
        decode: (values) =>
          // SAFETY: Retained values decoded successfully as this element; keep their encoded form for decodeTo to apply the element codec once.
          values.filter((value) => Option.isSome(decodeElement(value))) as ReadonlyArray<
            Element["Encoded"]
          >,
        encode: (values) => values,
      }),
    ),
  );
};

/**
 * Construct a branded identifier. Enforces non-empty trimmed strings
 */
const makeEntityId = <Brand extends string>(brand: Brand) => {
  return TrimmedNonEmptyString.pipe(Schema.brand(brand));
};

export const ThreadId = makeEntityId("ThreadId");

export type ThreadId = typeof ThreadId.Type;

export const ProjectId = makeEntityId("ProjectId");

export type ProjectId = typeof ProjectId.Type;

export const TaskId = makeEntityId("TaskId");

export type TaskId = typeof TaskId.Type;

export const BotId = makeEntityId("BotId");

export type BotId = typeof BotId.Type;

export const GroupId = makeEntityId("GroupId");

export type GroupId = typeof GroupId.Type;

export const ChannelConnectionId = makeEntityId("ChannelConnectionId");

export type ChannelConnectionId = typeof ChannelConnectionId.Type;

export const EnvironmentId = makeEntityId("EnvironmentId");

export type EnvironmentId = typeof EnvironmentId.Type;

export const CommandId = makeEntityId("CommandId");

export type CommandId = typeof CommandId.Type;

export const EventId = makeEntityId("EventId");

export type EventId = typeof EventId.Type;

export const MessageId = makeEntityId("MessageId");

export type MessageId = typeof MessageId.Type;

export const TurnId = makeEntityId("TurnId");

export type TurnId = typeof TurnId.Type;

export const AuthSessionId = makeEntityId("AuthSessionId");

const VisibilityValue = Schema.Literals(["user", "organization"]);

/** Records saved before Otto said organization still read `workspace`. */
const LegacyWorkspaceVisibility = Schema.Literal("workspace").pipe(
  Schema.decodeTo(
    VisibilityValue,
    SchemaTransformation.transform<typeof VisibilityValue.Type, "workspace">({
      decode: () => "organization",
      encode: () => "workspace",
    }),
  ),
);

/**
 * Otto: Who sees a record: `user` only the person who made it, `organization` everyone in
 * the organization (still within any chat, group or folder that holds it).
 */
export const Visibility = Schema.Union([VisibilityValue, LegacyWorkspaceVisibility]);

export type Visibility = typeof Visibility.Type;

export type AuthSessionId = typeof AuthSessionId.Type;

export const RpcClientId = NonNegativeInt.pipe(Schema.brand("RpcClientId"));

export type RpcClientId = typeof RpcClientId.Type;

/**
 * Which client app a connection comes from. Unlike
 * `AuthClientMetadataDeviceType` (a UA-style device class where web and
 * desktop are both "desktop"), this names the actual product surface.
 * Optional everywhere it appears: old clients never send it.
 */
export const ClientSurface = Schema.Literals(["web", "desktop", "mobile"]);

export type ClientSurface = typeof ClientSurface.Type;

export const ProviderItemId = makeEntityId("ProviderItemId");

export type ProviderItemId = typeof ProviderItemId.Type;

export const RuntimeSessionId = makeEntityId("RuntimeSessionId");

export type RuntimeSessionId = typeof RuntimeSessionId.Type;

export const RuntimeItemId = makeEntityId("RuntimeItemId");

export type RuntimeItemId = typeof RuntimeItemId.Type;

export const RuntimeRequestId = makeEntityId("RuntimeRequestId");

export type RuntimeRequestId = typeof RuntimeRequestId.Type;

export const RuntimeTaskId = makeEntityId("RuntimeTaskId");

export type RuntimeTaskId = typeof RuntimeTaskId.Type;

export const ApprovalRequestId = makeEntityId("ApprovalRequestId");

export type ApprovalRequestId = typeof ApprovalRequestId.Type;

export const CheckpointRef = makeEntityId("CheckpointRef");

export type CheckpointRef = typeof CheckpointRef.Type;

export const OttoUsageReservationId = makeEntityId("OttoUsageReservationId");

export type OttoUsageReservationId = typeof OttoUsageReservationId.Type;
