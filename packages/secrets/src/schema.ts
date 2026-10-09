import { pgTable, text, uuid } from "drizzle-orm/pg-core";

export const secrets = pgTable("secrets", {
  id: uuid().primaryKey(),
  title: text().notNull(),
  value: text().notNull(),
});
