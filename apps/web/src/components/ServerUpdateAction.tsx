import { Predicate } from "effect";
import type { EnvironmentId, ServerSelfUpdateCapability } from "@otto/contracts";
import type { ServerUpdateStage, ServerUpdateState } from "@otto/client-runtime/state/server";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@otto/client-runtime/state/runtime";

import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

// The wire "installing" stage is a sub-second launcher handoff, so the UI
// folds it into the download phase; everything after the handoff is the
// restart the user is actually waiting through.
const UPDATE_STAGE_LABELS: Record<ServerUpdateStage, string> = {
  downloading: "Downloading…",
  installing: "Downloading…",
  resuming: "Restarting…",
};

const pendingUpdateEnvironmentIds = new Set<EnvironmentId>();

export function serverUpdateStageLabel(stage: ServerUpdateStage): string {
  return UPDATE_STAGE_LABELS[stage];
}

function updateFailureMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Server update failed.";
}

/**
 * One-row status for an in-flight server update: "Downloading…" then
 * "Restarting…". The update is a wait, not a warning: a single pulsing dot
 * and label, no step rail, no versions. Failure turns the row red with the
 * rollback reason.
 */
export function ServerUpdateProgress({
  state,
}: {
  readonly state: Exclude<ServerUpdateState, { status: "idle" }>;
}) {
  if (state.status === "failed") {
    return (
      <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-destructive" role="alert">
        <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
        <Tooltip>
          <TooltipTrigger render={<span className="min-w-0 truncate">{state.message}</span>} />
          <TooltipPopup side="top" className="max-w-80">
            {state.message}
          </TooltipPopup>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-2 text-xs font-medium text-foreground">
      <span
        className="size-1.5 shrink-0 animate-status-pulse rounded-full bg-foreground"
        aria-hidden="true"
      />
      <span>{serverUpdateStageLabel(state.stage)}</span>
    </div>
  );
}

/**
 * Offers the update path advertised by a version-skewed server. Self-updates
 * delegate their full lifecycle to client-runtime so this component can
 * unmount during reconnect without losing operation state.
 */
export function ServerUpdateAction({
  environmentId,
  serverLabel,
  selfUpdate,
  targetVersion,
  label = "Update",
}: {
  readonly environmentId: EnvironmentId;
  readonly serverLabel: string;
  readonly selfUpdate: ServerSelfUpdateCapability | null;
  readonly targetVersion: string;
  readonly label?: string;
}) {
  const updateServer = useAtomCommand(serverEnvironment.updateServer, {
    reportFailure: false,
  });

  const handleUpdate = async () => {
    if (pendingUpdateEnvironmentIds.has(environmentId)) {
      return;
    }

    pendingUpdateEnvironmentIds.add(environmentId);

    try {
      const result = await updateServer({
        environmentId,
        input: { targetVersion },
      });

      if (Predicate.isTagged(result, "Failure")) {
        if (isAtomCommandInterrupted(result)) {
          return;
        }

        toastManager.add({
          type: "error",
          title: "Server update failed",
          description: updateFailureMessage(squashAtomCommandFailure(result)),
        });

        return;
      }

      toastManager.add({
        type: "success",
        title: `${serverLabel} updated`,
        description: `Reconnected on Otto ${result.value.targetVersion}.`,
      });
    } finally {
      pendingUpdateEnvironmentIds.delete(environmentId);
    }
  };

  if (selfUpdate === "desktop-managed") {
    return (
      <span className="text-muted-foreground text-xs">
        Update the desktop app on that machine to update this server.
      </span>
    );
  }

  if (selfUpdate === null) {
    return (
      <span className="text-muted-foreground text-xs">
        Install Otto {targetVersion} from your trusted source and relaunch this server. No npm
        package is published for this fork.
      </span>
    );
  }

  return (
    <Button size="xs" variant="outline" onClick={() => void handleUpdate()}>
      {label}
    </Button>
  );
}
