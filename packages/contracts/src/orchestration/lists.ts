import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../base-schemas.ts";

/** A discovery list page returns at most this many rows, and this many when no limit is asked. */
export const LIST_LIMIT_MAX = 100;

export const ListLimit = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(LIST_LIMIT_MAX),
);

export const ListOrder = Schema.Literals(["asc", "desc"]);

export type ListOrder = typeof ListOrder.Type;

/** The server's sealed position after a page's last row; clients pass it back unread. */
export const ListCursor = TrimmedNonEmptyString.check(Schema.isMaxLength(2048));

export type ListCursor = typeof ListCursor.Type;
