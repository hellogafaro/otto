import { Predicate } from "effect";
import { isAtomCommandInterrupted } from "@otto/client-runtime/state/runtime";
import { type KeybindingCommand, type ServerUpsertKeybindingInput } from "@otto/contracts";
import { useAtomValue } from "@effect/atom-react";

import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import { usePrimaryEnvironment } from "../../state/environments";
import { primaryServerKeybindingsAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { toast } from "sonner";
import { rowKeybindingTarget, ShortcutRecorder } from "./keybinding-editors";
import { KeybindingConflictWarning, KeyCaps } from "./keybinding-presentation";
import {
  type KeybindingRow,
  buildKeybindingCommandOptions,
  buildKeybindingGroups,
  buildKeybindingRows,
  commandLabel,
  describeWhenExpression,
  keybindingGroupForCommand,
} from "./keybindings-settings.logic";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settings-layout";

/**
 * Otto: One card per purpose group. Click the keys to record new ones; the
 * change saves at once, and the reset icon beside a changed command restores
 * its default. Commands without a default sit in their group, ready to record.
 */
export function KeybindingsSettingsPanel() {
  const { t } = useI18n();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const primaryEnvironment = usePrimaryEnvironment();

  const upsertKeybinding = useAtomCommand(serverEnvironment.upsertKeybinding, {
    reportFailure: false,
  });

  const removeKeybindingMutation = useAtomCommand(serverEnvironment.removeKeybinding, {
    reportFailure: false,
  });

  const rows = useMemo(() => buildKeybindingRows(keybindings), [keybindings]);
  const groups = useMemo(() => buildKeybindingGroups(rows), [rows]);

  const unboundCommands = useMemo(
    () =>
      buildKeybindingCommandOptions(keybindings).filter(
        (command) => !rows.some((row) => row.command === command),
      ),
    [keybindings, rows],
  );

  const saveKeybinding = useCallback(
    (input: ServerUpsertKeybindingInput) => {
      if (!primaryEnvironment) return;
      void (async () => {
        const result = await upsertKeybinding({
          environmentId: primaryEnvironment.environmentId,
          input,
        });

        if (Predicate.isTagged(result, "Success") || isAtomCommandInterrupted(result)) return;

        toast.error(t("Shortcut couldn't be saved"));
      })();
    },
    [primaryEnvironment, t, upsertKeybinding],
  );

  const removeKeybinding = useCallback(
    (row: KeybindingRow) => {
      if (!primaryEnvironment) return;
      void (async () => {
        const result = await removeKeybindingMutation({
          environmentId: primaryEnvironment.environmentId,
          input: rowKeybindingTarget(row),
        });

        if (Predicate.isTagged(result, "Success") || isAtomCommandInterrupted(result)) return;

        toast.error(t("Shortcut couldn't be removed"));
      })();
    },
    [primaryEnvironment, removeKeybindingMutation, t],
  );

  const resetKeybinding = (row: KeybindingRow) => {
    if (!row.defaultKey) {
      removeKeybinding(row);

      return;
    }

    saveKeybinding({
      command: row.command,
      key: row.defaultKey,
      ...(row.defaultWhen.trim().length > 0 ? { when: row.defaultWhen } : {}),
      replace: rowKeybindingTarget(row),
    });
  };

  const renderRow = (row: KeybindingRow) => {
    const title = commandLabel(row.command);

    return (
      <ShortcutRow
        key={row.id}
        title={title}
        description={describeWhenExpression(row.binding.whenAst)}
        value={row.key}
        conflicts={row.conflicts}
        resetAction={
          row.source === "Custom" ? (
            <SettingResetButton label={title} onClick={() => resetKeybinding(row)} />
          ) : null
        }
        onRecord={(key) =>
          saveKeybinding({
            command: row.command,
            key,
            ...(row.when.trim().length > 0 ? { when: row.when } : {}),
            replace: rowKeybindingTarget(row),
          })
        }
      />
    );
  };

  const renderUnboundRow = (command: KeybindingCommand) => (
    <ShortcutRow
      key={command}
      title={commandLabel(command)}
      description={null}
      value=""
      conflicts={[]}
      resetAction={null}
      onRecord={(key) => saveKeybinding({ command, key })}
    />
  );

  return (
    <SettingsPageContainer>
      {groups.map((group, index) => (
        <SettingsSection
          key={group.id}
          {...(index === 0 ? { id: "keybindings" } : {})}
          title={group.title}
        >
          {group.items.map((item) => {
            if (item.type === "row") return renderRow(item.row);
            const { series } = item;
            const customRows = series.rows.filter((row) => row.source === "Custom");
            const firstRow = series.rows[0];

            return (
              <SettingsRow
                key={series.id}
                title={series.title}
                description={
                  series.when && firstRow ? describeWhenExpression(firstRow.binding.whenAst) : null
                }
                resetAction={
                  customRows.length > 0 ? (
                    <SettingResetButton
                      label={series.title}
                      onClick={() => customRows.forEach(resetKeybinding)}
                    />
                  ) : null
                }
                control={
                  series.rangeKey ? (
                    <KeyCaps value={series.rangeKey} className="px-0.75" />
                  ) : (
                    <span className="text-12px text-muted-foreground">
                      {t("{count} shortcuts", { count: series.rows.length })}
                    </span>
                  )
                }
              />
            );
          })}
          {unboundCommands
            .filter((command) => keybindingGroupForCommand(command) === group.id)
            .map(renderUnboundRow)}
        </SettingsSection>
      ))}
    </SettingsPageContainer>
  );
}

function ShortcutRow({
  title,
  description,
  value,
  conflicts,
  resetAction,
  onRecord,
}: {
  title: string;
  description: string | null;
  value: string;
  conflicts: ReadonlyArray<string>;
  resetAction: ReactNode;
  onRecord: (key: string) => void;
}) {
  const [isRecording, setIsRecording] = useState(false);

  return (
    <SettingsRow
      title={title}
      description={description}
      resetAction={resetAction}
      control={
        <>
          <KeybindingConflictWarning labels={conflicts} />
          <ShortcutRecorder
            commandTitle={title}
            value={value}
            resetKey={value}
            isRecording={isRecording}
            onRecordingChange={setIsRecording}
            onChange={(key) => {
              if (key !== value) onRecord(key);
            }}
          />
        </>
      }
    />
  );
}
