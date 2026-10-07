/**
 * Cron Matching Utilities for Automations
 *
 * Determines if a cron expression matches the current time.
 * Used by SchedulerTick automations to trigger at specific intervals.
 */

import { Cron } from 'croner';
import { createLogger } from '../utils/debug.ts';

const log = createLogger('cron-matcher');

/**
 * Check if a cron expression matches a minute (the current one by default).
 * Uses croner's nextRun to determine if the minute matches the cron pattern.
 *
 * @param cronExpr - Cron expression in 5-field format (minute hour day-of-month month day-of-week)
 * @param timezone - Optional IANA timezone (e.g., "Europe/Budapest", "America/New_York")
 * @param now - The time to check (default: now)
 * @returns true if the cron expression matches the minute of `now`
 *
 * @example
 * matchesCron('* * * * *')                    // Matches every minute
 * matchesCron('0 9 * * *', 'Europe/Budapest') // Matches 9:00 AM Budapest time
 */
export function matchesCron(cronExpr: string, timezone?: string, now: Date = new Date()): boolean {
  try {
    const options = timezone ? { timezone } : {};
    const job = new Cron(cronExpr, options);

    // Get start of current minute (floored to :00 seconds)
    const startOfMinute = new Date(now);
    startOfMinute.setSeconds(0, 0);

    // Check from 1 second before the start of this minute
    const checkFrom = new Date(startOfMinute.getTime() - 1000);
    const nextRun = job.nextRun(checkFrom);

    log.debug(`[matchesCron] cron=${cronExpr}, tz=${timezone || 'default'}`);
    log.debug(`[matchesCron] now=${now.toISOString()}, startOfMinute=${startOfMinute.toISOString()}`);
    log.debug(`[matchesCron] checkFrom=${checkFrom.toISOString()}, nextRun=${nextRun?.toISOString() || 'null'}`);

    // If nextRun falls within the current minute, we have a match
    if (!nextRun) {
      log.debug(`[matchesCron] No nextRun, returning false`);
      return false;
    }

    const matches = nextRun.getTime() >= startOfMinute.getTime() &&
           nextRun.getTime() < startOfMinute.getTime() + 60_000;
    log.debug(`[matchesCron] matches=${matches} (nextRun ${nextRun.getTime()} vs startOfMinute ${startOfMinute.getTime()} to ${startOfMinute.getTime() + 60_000})`);
    return matches;
  } catch (e) {
    console.error(`[matchesCron] Error:`, e);
    return false;
  }
}

/**
 * The next time a cron expression fires after `from` (exclusive), in its timezone (the runtime's when none);
 * null for an invalid expression or one that never fires again.
 *
 * @example
 * nextCronRun('0 14 * * *', undefined, new Date(2026, 9, 7, 9)) // Oct 7 2026, 14:00 local
 */
export function nextCronRun(cronExpr: string, timezone?: string, from: Date = new Date()): Date | null {
  try {
    return new Cron(cronExpr, timezone ? { timezone } : {}).nextRun(from);
  } catch {
    return null;
  }
}
