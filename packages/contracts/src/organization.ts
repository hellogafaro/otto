import * as Schema from "effect/Schema";

export const OrganizationRole = Schema.Literals(["admin", "member"]);

export type OrganizationRole = typeof OrganizationRole.Type;

export const OrganizationAccountState = Schema.Struct({
  organization: Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String })),
  user: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      email: Schema.String,
      firstName: Schema.String,
      lastName: Schema.String,
      image: Schema.optional(Schema.NullOr(Schema.String)),
      emailVerified: Schema.Boolean,
    }),
  ),
  role: Schema.NullOr(OrganizationRole),
  mailConfigured: Schema.Boolean,
});

export type OrganizationAccountState = typeof OrganizationAccountState.Type;
