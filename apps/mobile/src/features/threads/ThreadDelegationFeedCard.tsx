import { Predicate } from "effect";
import { Match } from "effect";
/**
 * The feed's delegation card wired to the environment: Let it finish and Cancel
 * send the same cancel command the web card sends (keep true or false), and Try
 * again sends `delegation.retry`. A refused command shows the server's reason.
 *
 * @module features/threads/ThreadDelegationFeedCard
 */
import type { OttoDelegationRecord, EnvironmentId, OrchestrationBot } from "@otto/contracts";
import type { DelegationAction } from "@otto/client-runtime/delegation-presentation";
import { squashAtomCommandFailure } from "@otto/client-runtime/state/runtime";
import { useCallback } from "react";
import { Alert } from "react-native";

import { useMobileI18n } from "../../lib/i18n";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useAtomCommand } from "../../state/use-atom-command";
import { ThreadDelegationCard } from "./ThreadDelegationCard";

export function ThreadDelegationFeedCard(props: {
  readonly environmentId: EnvironmentId;
  readonly delegation: OttoDelegationRecord;
  readonly actions: ReadonlyArray<DelegationAction>;
  readonly childBot: OrchestrationBot | null;
  readonly parentBot: OrchestrationBot | null;
}) {
  const { t } = useMobileI18n();
  const { environmentId } = props;
  const { delegationId } = props.delegation;

  const cancelDelegation = useAtomCommand(orchestrationEnvironment.cancelDelegation, {
    reportFailure: false,
  });

  const retryDelegation = useAtomCommand(orchestrationEnvironment.retryDelegation, {
    reportFailure: false,
  });

  const onAction = useCallback(
    async (action: DelegationAction) => {
      const result =
        action === "retry"
          ? await retryDelegation({ environmentId, input: { delegationId } })
          : await cancelDelegation({
              environmentId,
              input: { delegationId, keep: action === "keep" },
            });

      if (!Predicate.isTagged(result, "Failure")) return;
      const error = squashAtomCommandFailure(result);

      const title = Match.value(action).pipe(
        Match.when("keep", () => t("Could not let the work finish")),
        Match.when("cancel", () => t("Could not cancel delegation")),
        Match.orElse(() => t("Could not retry the work")),
      );

      Alert.alert(title, error instanceof Error ? error.message : undefined);
    },
    [cancelDelegation, delegationId, environmentId, retryDelegation, t],
  );

  return (
    <ThreadDelegationCard
      delegation={props.delegation}
      childBot={props.childBot}
      parentBot={props.parentBot}
      actions={props.actions}
      onAction={onAction}
    />
  );
}
