/**
 * Centralized path configuration for Otto.
 *
 * `CONFIG_DIR` is the one place that decides where the app keeps its state
 * (`~/.otto` by default). Every other module joins onto it; never join
 * `homedir()` with `.otto` directly (OSS #1062).
 *
 * Supports multi-instance development via the OTTO_CONFIG_DIR environment
 * variable. When running from a numbered folder (e.g., otto-tui-agent-1), the
 * detect-instance.sh script sets OTTO_CONFIG_DIR to ~/.otto-1, allowing
 * multiple instances to run simultaneously with separate configurations.
 *
 * Default (non-numbered folders): ~/.otto/
 * Instance 1 (-1 suffix): ~/.otto-1/
 * Instance 2 (-2 suffix): ~/.otto-2/
 *
 * Two modules re-derive this from the environment on purpose because they must
 * stay import-free: `interceptor-common.ts` (preloaded into the Pi subprocess)
 * and session-tools-core `handlers/config-validate.ts` (no dependency on shared).
 */

import { homedir } from 'os';
import { join } from 'path';

export const DEFAULT_CONFIG_DIR_NAME = '.otto';

/**
 * Resolve the config directory: a non-empty OTTO_CONFIG_DIR wins, otherwise
 * `<home>/.otto`. Pure; `CONFIG_DIR` is this evaluated once at load.
 */
export function resolveConfigDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const override = env.OTTO_CONFIG_DIR?.trim();
  return override ? override : join(home, DEFAULT_CONFIG_DIR_NAME);
}

export const CONFIG_DIR = resolveConfigDir();
