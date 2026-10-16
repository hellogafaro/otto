import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** Settings pages' URL search; Members filters its people and invitations by `q`. */
const SettingsSearch = Schema.Struct({
  q: Schema.optional(Schema.String),
});

export type SettingsSearch = typeof SettingsSearch.Type;

const decodeSettingsSearch = Schema.decodeUnknownOption(SettingsSearch);

/** A malformed search shows the whole page instead of failing. */
export const parseSettingsSearch = (search: Parameters<typeof decodeSettingsSearch>[0]) =>
  Option.getOrElse(decodeSettingsSearch(search), (): SettingsSearch => ({}));

/** Case-insensitive match of a search against a name and email; an empty search matches all. */
export function matchesMemberSearch(query: string, ...fields: readonly string[]): boolean {
  const needle = query.trim().toLowerCase();

  return fields.some((field) => field.toLowerCase().includes(needle));
}
