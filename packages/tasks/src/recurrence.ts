import { DomainError } from "@otto/shared";
import { RRuleTemporal } from "rrule-temporal";

/**
 * Task recurrence is one RFC 5545 text value: the original DTSTART anchor (local time plus IANA zone) and one RRULE.
 * The library is lax about unknown parts, extra lines, floating times and EXDATE, so this strict boundary validates
 * and re-serializes first, then asks the library only for the next instant. Tested limits: docs/tasks.md.
 */
export const MAX_RECURRENCE_BYTES = 400;
const MAX_COUNT = 1000;
// The library's candidate-evaluation budget (default 1,000,000, about 3.5 s synchronous in the worst measured rule) is
// lowered to 10,000. This bounds work, not wall time.
// Measured with legitimate sparse, leap and COUNT=1000 rules in the scratch qualification (docs/tasks.md).
const MAX_CANDIDATES = 10_000;
// Instants must stay representable as ISO years 0000-9999 for JSON and PostgreSQL.
const MAX_INSTANT = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
const MAX_INTERVAL = 1000;
const FREQS = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const DTSTART = /^DTSTART;TZID=([A-Za-z0-9_+\-/]{1,64}):(\d{8}T\d{6})$/;
const STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;
const BYDAY = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/;
const invalid = () => new DomainError("invalid", "Invalid recurrence");

/** True for a real calendar date and wall-clock time. */
function validStamp(value: string, utc: boolean) {
  const m = STAMP.exec(value);
  if (!m || (m[7] === "Z") !== utc) return false;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return (
    y >= 1970 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi &&
    date.getUTCSeconds() === s
  );
}
function ints(value: string, min: number, max: number, limit: number) {
  const parts = value.split(",");
  const numbers = parts.map((part) => (/^[+-]?\d+$/.test(part) ? +part : NaN));
  if (
    parts.length > limit ||
    new Set(numbers).size !== numbers.length ||
    numbers.some((n) => !Number.isInteger(n) || n === 0 || n < min || n > max)
  )
    throw invalid();
  return numbers.join(",");
}

/** Strictly validates and re-serializes the two-line form; throws a DomainError before any write. */
export function parseRecurrence(input: unknown) {
  if (
    typeof input !== "string" ||
    Buffer.byteLength(input) > MAX_RECURRENCE_BYTES
  )
    throw invalid();
  const lines = input.trim().split(/\r?\n/);
  const start = DTSTART.exec(lines[0] ?? "");
  if (lines.length !== 2 || !start || !lines[1]?.startsWith("RRULE:"))
    throw invalid();
  const [, zone = "", local = ""] = start;
  let tzid: string;
  try {
    tzid = new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions()
      .timeZone;
  } catch {
    throw invalid();
  }
  if (!validStamp(local, false)) throw invalid();
  const parts = new Map<string, string>();
  for (const part of lines[1].slice(6).split(";")) {
    const [key, value, ...rest] = part.split("=");
    const name = key?.toUpperCase();
    if (!name || !value || rest.length || parts.has(name)) throw invalid();
    parts.set(name, value.toUpperCase());
  }
  const allowed = [
    "FREQ",
    "INTERVAL",
    "COUNT",
    "UNTIL",
    "BYMONTH",
    "BYMONTHDAY",
    "BYDAY",
    "BYSETPOS",
    "WKST",
  ];
  const freq = parts.get("FREQ");
  if (
    !freq ||
    !FREQS.includes(freq) ||
    [...parts.keys()].some((key) => !allowed.includes(key)) ||
    (parts.has("COUNT") && parts.has("UNTIL"))
  )
    throw invalid();
  const out = [`FREQ=${freq}`];
  const interval = parts.get("INTERVAL");
  if (interval !== undefined) {
    if (!/^\d+$/.test(interval) || +interval < 1 || +interval > MAX_INTERVAL)
      throw invalid();
    out.push(`INTERVAL=${+interval}`);
  }
  const month = parts.get("BYMONTH");
  if (month !== undefined) out.push(`BYMONTH=${ints(month, 1, 12, 12)}`);
  const monthDay = parts.get("BYMONTHDAY");
  if (monthDay !== undefined)
    out.push(`BYMONTHDAY=${ints(monthDay, -31, 31, 31)}`);
  const days = parts.get("BYDAY");
  if (days !== undefined) {
    const tokens = days.split(",");
    const matched = tokens.map((token) => BYDAY.exec(token));
    const yearly = freq === "YEARLY";
    // Qualified boundary of the library (docs/tasks.md): YEARLY ordinals stop at +/-52 (53 spills into the next year),
    // and without BYMONTH a plain weekday beside an ordinal one is silently dropped and BYMONTHDAY beside an ordinal is ignored, so those are rejected.
    const ordinal = matched.some((m) => m?.[1] !== undefined);
    const mixed =
      yearly &&
      !parts.has("BYMONTH") &&
      ((ordinal && matched.some((m) => m?.[1] === undefined)) ||
        // The library ignores BYMONTHDAY beside an ordinal BYDAY in a year-wide YEARLY rule.
        (ordinal && parts.has("BYMONTHDAY")));
    if (
      tokens.length > 14 ||
      new Set(tokens).size !== tokens.length ||
      mixed ||
      matched.some(
        (m) =>
          !m ||
          (m[1] !== undefined &&
            (!["MONTHLY", "YEARLY"].includes(freq) ||
              +m[1] === 0 ||
              Math.abs(+m[1]) > (yearly ? 52 : 53))),
      )
    )
      throw invalid();
    out.push(`BYDAY=${tokens.join(",")}`);
  }
  const position = parts.get("BYSETPOS");
  if (position !== undefined) {
    if (!["BYMONTH", "BYMONTHDAY", "BYDAY"].some((key) => parts.has(key)))
      throw invalid();
    out.push(`BYSETPOS=${ints(position, -366, 366, 31)}`);
  }
  const wkst = parts.get("WKST");
  if (wkst !== undefined) {
    if (!DAYS.includes(wkst)) throw invalid();
    out.push(`WKST=${wkst}`);
  }
  const count = parts.get("COUNT");
  if (count !== undefined) {
    if (!/^\d+$/.test(count) || +count < 1 || +count > MAX_COUNT)
      throw invalid();
    out.push(`COUNT=${+count}`);
  }
  const until = parts.get("UNTIL");
  if (until !== undefined) {
    // RFC 5545 §3.3.10: UNTIL is UTC when DTSTART has a TZID.
    if (!validStamp(until, true)) throw invalid();
    out.push(`UNTIL=${until}`);
  }
  const canonical = `DTSTART;TZID=${tzid}:${local}\nRRULE:${out.join(";")}`;
  if (Buffer.byteLength(canonical) > MAX_RECURRENCE_BYTES) throw invalid();
  // Rejected here, with a bounded evaluator, rather than at completion: no occurrence, beyond the representable range,
  // beyond the work budget now, or (for COUNT) beyond the budget when walked to its end.
  try {
    const first = evaluate(canonical, new Date(Date.UTC(1969, 11, 1)));
    if (!first)
      throw new DomainError("invalid", "Recurrence has no occurrence");
    const bounded = parts.has("COUNT") || parts.has("UNTIL");
    if (!evaluate(canonical, new Date()) && !bounded)
      throw new DomainError(
        "invalid",
        "Recurrence has no supported occurrence",
      );
    if (parts.has("COUNT")) evaluate(canonical, new Date(MAX_INSTANT - 1));
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("invalid", "Unsupported recurrence");
  }
  return canonical;
}

/** One bounded library call; an instant beyond year 9999 is an error, never a result. */
function evaluate(recurrence: string, after: Date) {
  const next = new RRuleTemporal({
    rruleString: recurrence,
    strict: true,
    maxCandidateEvaluations: MAX_CANDIDATES,
  }).next(after);
  if (next && next.epochMilliseconds > MAX_INSTANT)
    throw new RangeError("range");
  return next ? new Date(next.epochMilliseconds) : null;
}

/**
 * First occurrence STRICTLY after `after`. null means COUNT/UNTIL is exhausted; a limit, an unrepresentable instant, or
 * no result for an unbounded rule is a conflict, never exhaustion, raised before any mutation.
 */
export function nextOccurrence(recurrence: string, after: Date) {
  const unevaluable = () =>
    new DomainError("conflict", "Recurrence cannot be evaluated");
  let next: Date | null;
  try {
    next = evaluate(recurrence, after);
  } catch {
    throw unevaluable();
  }
  if (!next && !/;(COUNT|UNTIL)=/.test(recurrence)) throw unevaluable();
  return next;
}
