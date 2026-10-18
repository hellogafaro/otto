import type { EnvironmentId, RoutineAppTrigger } from "@otto/contracts";

import { useI18n } from "../../i18n";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { DetailsRow } from "../details-aside";

/**
 * Otto: An app routine's Trigger and Account rows in the routine details, in place of its
 * schedule and next run. The trigger reads "Not live" while the routine is on but the app is
 * not sending events (no public address, or the trigger is not set up yet); the account shows
 * its label, else its signed-in name, else "Unavailable" when it is gone or not yours to see.
 */
export function RoutineTriggerRows({
  environmentId,
  trigger,
  enabled,
}: {
  readonly environmentId: EnvironmentId;
  readonly trigger: RoutineAppTrigger;
  readonly enabled: boolean;
}) {
  const { t } = useI18n();

  const status = useEnvironmentQuery(
    serverEnvironment.composioStatus({ environmentId, input: {} }),
  );

  const account = status.data?.connections.find(
    (connection) => connection.id === trigger.connectionId,
  );

  return (
    <>
      <DetailsRow label={t("Trigger")}>
        <span className="truncate px-2.5 text-sm text-foreground">
          {trigger.title}
          {enabled && trigger.triggerId === null ? (
            <span className="text-muted-foreground"> · {t("Not live")}</span>
          ) : null}
        </span>
      </DetailsRow>
      <DetailsRow label={t("Account")}>
        <span className="truncate px-2.5 text-sm text-foreground">
          {account
            ? (account.alias ?? account.accountName ?? account.toolkitName ?? trigger.app)
            : status.data
              ? t("Unavailable")
              : ""}
        </span>
      </DetailsRow>
    </>
  );
}
