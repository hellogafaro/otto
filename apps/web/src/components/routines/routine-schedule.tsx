import { RoutineWeekday, type RoutineHourInterval, type RoutineSchedule } from "@otto/contracts";
import { ROUTINE_HOUR_INTERVALS } from "@otto/client-runtime/routines";
import { type ReactNode, useRef, useState } from "react";

import { useAutosave } from "../../hooks/use-autosave";
import { useI18n } from "../../i18n";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

type Repeat = `hourly-${RoutineHourInterval}` | "daily" | "weekdays" | "weekly";

const REPEATS: readonly Repeat[] = [
  ...ROUTINE_HOUR_INTERVALS.map((hours) => `hourly-${hours}` as const),
  "daily",
  "weekdays",
  "weekly",
];

const repeatOf = (schedule: RoutineSchedule): Repeat =>
  schedule.kind === "hourly" ? `hourly-${schedule.everyHours}` : schedule.kind;

const timeZones = (current: string) => {
  const zones = Intl.supportedValuesOf("timeZone");

  return zones.includes(current) ? zones : [current, ...zones];
};

/**
 * Otto: A routine's Schedule row on its page: the schedule as text that opens a popover to
 * change how often it runs, at what time, on which days and in which time zone. Each change
 * saves itself like the rest of the app, 800ms after the last one and at once when the popover
 * closes; saving moves the next run to the new schedule and the routine's approval stays.
 */
export function RoutineScheduleEdit({
  schedule,
  timezone,
  label,
  onSave,
}: {
  readonly schedule: RoutineSchedule;
  readonly timezone: string;
  readonly label: string;
  readonly onSave: (next: {
    readonly schedule: RoutineSchedule;
    readonly timezone: string;
  }) => void;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>(repeatOf(schedule));
  const [time, setTime] = useState(schedule.time);

  const [weekdays, setWeekdays] = useState<readonly RoutineWeekday[]>(
    schedule.kind === "weekly" ? schedule.weekdays : ["monday"],
  );

  const [zone, setZone] = useState(timezone);

  const repeatLabel = (value: Repeat) => {
    if (value === "daily") return t("Daily");

    if (value === "weekdays") return t("Weekdays");

    if (value === "weekly") return t("Weekly");

    const hours = Number(value.slice(7));

    return hours === 1 ? t("Hourly") : t("Every {count} hours", { count: hours });
  };

  const dayName = (index: number, weekday: "short" | "long") =>
    new Intl.DateTimeFormat(locale, { weekday, timeZone: "UTC" }).format(
      Date.UTC(2024, 0, 1 + index),
    );

  const next = ((): RoutineSchedule => {
    if (repeat === "daily" || repeat === "weekdays") return { kind: repeat, time };

    if (repeat === "weekly") return { kind: "weekly", weekdays, time };

    return {
      kind: "hourly",
      everyHours: ROUTINE_HOUR_INTERVALS.find((hours) => `hourly-${hours}` === repeat) ?? 1,
      time,
    };
  })();

  const valid = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) && weekdays.length > 0;
  const saved = useRef(JSON.stringify({ schedule, timezone }));

  const autosave = useAutosave(() => {
    const key = JSON.stringify({ schedule: next, timezone: zone });

    if (!valid || key === saved.current) return;
    saved.current = key;
    onSave({ schedule: next, timezone: zone });
  });

  const edit = (change: () => void) => {
    change();
    autosave.schedule();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setRepeat(repeatOf(schedule));
          setTime(schedule.time);
          setWeekdays(schedule.kind === "weekly" ? schedule.weekdays : ["monday"]);
          setZone(timezone);
          saved.current = JSON.stringify({ schedule, timezone });
        } else {
          autosave.flush();
        }

        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="min-w-0 max-w-full"
            aria-label={t("Edit schedule")}
          />
        }
      >
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="end" className="w-72">
        <div className="flex flex-col gap-3">
          <ScheduleField label={t("Repeat")}>
            <Select
              value={repeat}
              onValueChange={(value) => {
                const picked = REPEATS.find((option) => option === value);

                if (picked) edit(() => setRepeat(picked));
              }}
            >
              <SelectTrigger size="sm" aria-label={t("Repeat")}>
                <SelectValue>{repeatLabel(repeat)}</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {REPEATS.map((option) => (
                  <SelectItem key={option} hideIndicator value={option}>
                    {repeatLabel(option)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </ScheduleField>
          {repeat === "weekly" ? (
            <ScheduleField label={t("Days")}>
              <ToggleGroup
                aria-label={t("Days")}
                variant="segmented"
                multiple
                className="w-full *:flex-1"
                value={[...weekdays]}
                onValueChange={(value) =>
                  edit(() =>
                    setWeekdays(RoutineWeekday.literals.filter((day) => value.includes(day))),
                  )
                }
              >
                {RoutineWeekday.literals.map((day, index) => (
                  <Toggle key={day} value={day} aria-label={dayName(index, "long")}>
                    {dayName(index, "short")}
                  </Toggle>
                ))}
              </ToggleGroup>
            </ScheduleField>
          ) : null}
          <ScheduleField label={t("Time")}>
            <Input
              nativeInput
              size="sm"
              type="time"
              aria-label={t("Time")}
              value={time}
              onChange={(event) => edit(() => setTime(event.target.value))}
            />
          </ScheduleField>
          <ScheduleField label={t("Time zone")}>
            <Select value={zone} onValueChange={(value) => value && edit(() => setZone(value))}>
              <SelectTrigger size="sm" aria-label={t("Time zone")}>
                <SelectValue>{zone}</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {timeZones(zone).map((option) => (
                  <SelectItem key={option} hideIndicator value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </ScheduleField>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function ScheduleField({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
