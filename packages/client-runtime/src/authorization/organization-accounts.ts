import { createAuthClient } from "better-auth/client";
import {
  emailOTPClient,
  inferAdditionalFields,
  organizationClient,
} from "better-auth/client/plugins";
import { adminAc, memberAc } from "better-auth/plugins/organization/access";
import { OrganizationAccountState } from "@otto/contracts";
import * as Schema from "effect/Schema";

// Otto: A bearer client (the desktop app) never sends cookies, even before it has signed in.
export function createOrganizationAccountsClient(
  baseURL: string,
  bearerToken?: string,
  options?: { readonly bearer?: boolean },
) {
  return createAuthClient({
    baseURL,
    basePath: "/api/accounts",
    fetchOptions: {
      credentials: bearerToken || options?.bearer ? "omit" : "include",
      ...(bearerToken ? { headers: { authorization: `Bearer ${bearerToken}` } } : {}),
    },
    plugins: [
      organizationClient({ roles: { admin: adminAc, member: memberAc } }),
      emailOTPClient(),
      inferAdditionalFields({
        user: {
          firstName: { type: "string", required: true },
          lastName: { type: "string", required: true },
        },
      }),
    ],
  });
}

export async function getOrganizationAccountState(
  baseURL: string,
  bearerToken?: string,
  options?: { readonly bearer?: boolean },
) {
  const response = await createOrganizationAccountsClient(baseURL, bearerToken, options).$fetch(
    new URL("/api/organization", baseURL).toString(),
    { timeout: 10_000 },
  );

  if (response.error) throw new Error("Could not load the organization.");

  return Schema.decodeUnknownSync(OrganizationAccountState)(response.data);
}
