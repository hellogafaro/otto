import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt } from "./base-schemas.ts";
import { HostPowerSnapshot } from "./background.ts";

/**
 * Otto: The desktop app streams the host's power state to its local server over this channel, so
 * background work can pause on battery, low power or a locked screen.
 */
export const DesktopTelemetryStatus = Schema.Literals([
  "starting",
  "healthy",
  "degraded",
  "unavailable",
  "stopped",
]);

export type DesktopTelemetryStatus = typeof DesktopTelemetryStatus.Type;

const DesktopHostPowerSnapshot = Schema.Struct({
  ...HostPowerSnapshot.fields,
  updatedAt: Schema.DateTimeUtcFromString,
});

export const DesktopHostTelemetrySnapshot = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("desktopTelemetry"),
  sequence: NonNegativeInt,
  sampledAtUnixMs: NonNegativeInt,
  electronPid: PositiveInt,
  power: DesktopHostPowerSnapshot,
  speedLimitPercent: Schema.OptionFromNullOr(Schema.Number),
});

export type DesktopHostTelemetrySnapshot = typeof DesktopHostTelemetrySnapshot.Type;

export const DesktopHostTelemetryHello = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("desktopTelemetryHello"),
  electronPid: PositiveInt,
});

export type DesktopHostTelemetryHello = typeof DesktopHostTelemetryHello.Type;

export const DesktopHostTelemetryMessage = Schema.Union([
  DesktopHostTelemetryHello,
  DesktopHostTelemetrySnapshot,
]);

export type DesktopHostTelemetryMessage = typeof DesktopHostTelemetryMessage.Type;

export const DesktopTelemetrySetHostPowerIntervals = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("setHostPowerIntervals"),
  activeIntervalMs: PositiveInt,
  idleIntervalMs: PositiveInt,
});

export type DesktopTelemetrySetHostPowerIntervals =
  typeof DesktopTelemetrySetHostPowerIntervals.Type;

export const DesktopTelemetryControlMessage = DesktopTelemetrySetHostPowerIntervals;

export type DesktopTelemetryControlMessage = typeof DesktopTelemetryControlMessage.Type;
