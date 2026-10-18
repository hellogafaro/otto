import { RoutineListView } from "@otto/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** What the Routines page puts in its URL: statuses as one comma list. */
export const encodeRoutineSearch = Schema.encodeSync(RoutineListView);

/** URL search to a routine view; a malformed URL shows the unfiltered list instead of failing. */
export const parseRoutineSearch = (search: Parameters<typeof decodeRoutineSearch>[0]) =>
  Option.getOrElse(decodeRoutineSearch(search), (): RoutineListView => ({}));

const decodeRoutineSearch = Schema.decodeUnknownOption(RoutineListView);
