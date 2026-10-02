import { DomainError } from "@otto/shared";

import { z } from "zod";

/** A provider must demonstrate these properties before Otto can dispatch to it. No local implementation exists. */
export const computerCapabilities = z.object({
  isolated: z.literal(true),
  persistent: z.literal(true),
  scopeIsolation: z.literal(true),
  launchLookup: z.literal(true),
  deadline: z.literal(true),
  treeStop: z.literal(true),
  stdio: z.literal(true),
  files: z.literal(true),
});
export interface ComputerProcess {
  reference: string;
  stdout: ReadableStream<Uint8Array>;
  write(bytes: Uint8Array): Promise<void>;
  exit: Promise<number>;
  /** True acknowledges the whole execution tree, not just its root process. */
  stop(): Promise<{ stopped: boolean }>;
  /** Detaches server I/O only; it must not silently kill or relaunch the execution. */
  detach(): Promise<void>;
}
export type ProcessInspection =
  | { state: "absent" | "unknown" }
  | { state: "running"; process: ComputerProcess }
  | { state: "exited"; reference: string; exitCode: number; stopped: boolean };
export interface ComputerBackend {
  provider: string;
  inspectComputer(reference: string): Promise<{
    capabilities: unknown;
    /** Provider-native account association, never its credential. Null for scripts-only computers. */
    account: { connectionId: string; mode: "native_subscription" } | null;
  }>;
  /** launchKey is durable/idempotent; deadline and scope isolation must survive server loss. */
  launch(input: {
    computerRef: string;
    launchKey: string;
    scope: string;
    argv: string[];
    /** Execution copies in this scope; relative paths only, never credential files. */
    files: { path: string; bytes: Uint8Array }[];
    deadlineAt: Date;
    maxOutputBytes: number;
  }): Promise<ComputerProcess>;
  lookup(computerRef: string, launchKey: string): Promise<ProcessInspection>;
}
export function requireComputerCapabilities(value: unknown) {
  if (!computerCapabilities.safeParse(value).success)
    throw new DomainError(
      "unavailable",
      "Computer lacks required isolation/lifecycle capabilities",
    );
}
