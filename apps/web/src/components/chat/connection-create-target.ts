import { Option, Predicate, Schema } from "effect";

import { loadDirectoryCatalog } from "../../../../../plugins";
import type { PendingApproval } from "../../session-logic";

const DIRECTORY = new Map(loadDirectoryCatalog().map((plugin) => [plugin.id, plugin]));

const decodeArgs = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Json));

export interface ConnectionCreateTarget {
  readonly name: string;
  readonly detail: string | null;
  readonly logoUrl: string | undefined;
}

function textField(record: Schema.JsonObject, key: string): string | null {
  const value = record[key];

  return Predicate.isString(value) && value.trim() ? value.trim() : null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/** The one app a connection_create approval is adding, or null when the args name nothing. */
export function connectionCreateTarget(
  args: PendingApproval["args"],
): ConnectionCreateTarget | null {
  const record = Option.getOrNull(decodeArgs(args));

  if (!record) return null;

  const pluginId = textField(record, "pluginId");

  if (pluginId) {
    const plugin = DIRECTORY.get(pluginId);

    return {
      name: plugin?.name ?? pluginId,
      detail: plugin?.description ?? null,
      logoUrl: plugin?.logo.src,
    };
  }

  const title = textField(record, "title");

  if (title) {
    const url = textField(record, "url");

    return {
      name: title,
      detail: url ? hostOf(url) : null,
      logoUrl: undefined,
    };
  }

  return null;
}
