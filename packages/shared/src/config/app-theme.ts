import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonFileSync } from '../utils/files.ts';
import { CONFIG_DIR } from './paths.ts';
import type { ThemeOverrides } from './theme.ts';

/** The app-level theme override file (`theme.json` in the config dir); a file, no database (the desktop's main process reads it). */
export const APP_THEME_FILE = join(CONFIG_DIR, 'theme.json');

/**
 * Load app-level theme overrides
 */
export function loadAppTheme(): ThemeOverrides | null {
  try {
    if (!existsSync(APP_THEME_FILE)) {
      return null;
    }
    return readJsonFileSync<ThemeOverrides>(APP_THEME_FILE);
  } catch {
    return null;
  }
}
