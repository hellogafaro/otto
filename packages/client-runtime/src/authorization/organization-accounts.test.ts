import { OrganizationAccountState } from "@otto/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createOrganizationAccountsClient,
  getOrganizationAccountState,
} from "./organization-accounts.ts";

const baseURL = "http://127.0.0.1:43210";

afterEach(() => vi.unstubAllGlobals());

describe("organization accounts client for the desktop app", () => {
  it("reads the bearer session from sign-in and sends it, without cookies, to the membership check", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push({
        url,
        init:
          input instanceof Request
            ? { ...init, headers: input.headers, credentials: input.credentials }
            : init,
      });

      if (url.endsWith("/api/accounts/sign-in/email")) {
        return Response.json(
          { token: "session-token", user: { id: "u1" } },
          { headers: { "set-auth-token": "session-token" } },
        );
      }

      const state: typeof OrganizationAccountState.Encoded = {
        organization: { id: "o1", name: "Org" },
        user: null,
        role: "admin",
        mailConfigured: false,
        setupCodeRequired: false,
      };

      return Response.json(state);
    });

    let token: string | undefined;

    const result = await createOrganizationAccountsClient(baseURL, undefined, {
      bearer: true,
    }).signIn.email(
      { email: "dana@example.test", password: "Desk-password-42" },
      {
        onSuccess: (context) => {
          token = context.response.headers.get("set-auth-token") ?? undefined;
        },
      },
    );

    expect(result.error).toBeNull();
    expect(token).toBe("session-token");

    const state = await getOrganizationAccountState(baseURL, token, { bearer: true });
    expect(state.role).toBe("admin");

    for (const request of requests) expect(request.init?.credentials).toBe("omit");

    expect(new Headers(requests.at(-1)?.init?.headers).get("authorization")).toBe(
      "Bearer session-token",
    );
  });
});
