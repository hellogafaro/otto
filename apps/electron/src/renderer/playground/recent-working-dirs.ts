export type RecentDirScenario = 'none' | 'few' | 'many'

const RECENT_DIR_SCENARIO_DATA: Record<RecentDirScenario, string[]> = {
  none: [],
  few: [
    '/Users/demo/projects/otto',
    '/Users/demo/projects/otto/apps/electron',
    '/Users/demo/projects/otto/packages/shared',
  ],
  many: [
    '/Users/demo/projects/otto',
    '/Users/demo/projects/otto/apps/electron',
    '/Users/demo/projects/otto/apps/viewer',
    '/Users/demo/projects/otto/apps/cli',
    '/Users/demo/projects/otto/packages/shared',
    '/Users/demo/projects/otto/packages/server-core',
    '/Users/demo/projects/otto/packages/pi-agent-server',
    '/Users/demo/projects/otto/packages/ui',
    '/Users/demo/projects/otto/scripts',
  ],
}

/** Return a copy of the fixture list for the selected scenario. */
export function getRecentDirsForScenario(scenario: RecentDirScenario): string[] {
  return [...RECENT_DIR_SCENARIO_DATA[scenario]]
}
