import { isJsonValue } from "./json.ts";
import { decodePluginManifest } from "./decode-manifest.ts";
import type { PluginManifest } from "./manifest-types.ts";
import { validateManifest } from "./validate-manifest.ts";

export { PLUGIN_SCHEMA_VERSION, type PluginManifest, type PluginSkill } from "./manifest-types.ts";

export function parsePluginManifest<T>(input: T, source = "plugin manifest"): PluginManifest {
  try {
    if (!isJsonValue(input)) throw new TypeError("plugin manifest must contain JSON values.");

    return validateManifest(decodePluginManifest(input));
  } catch (error) {
    throw new TypeError(`${source} is invalid: ${String(error)}`, { cause: error });
  }
}

export function parsePluginManifestJson(input: string, source = "plugin manifest"): PluginManifest {
  try {
    const value = JSON.parse(input);

    if (!isJsonValue(value)) throw new TypeError("plugin manifest must contain JSON values.");

    return validateManifest(decodePluginManifest(value));
  } catch (error) {
    throw new TypeError(`${source} is invalid: ${String(error)}`, { cause: error });
  }
}
