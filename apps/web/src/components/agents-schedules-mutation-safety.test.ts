import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubGlobal("window", {
    location: { origin: "http://otto-fixture.invalid" },
  });
});

import { read } from "../lib/api";
import {
  hasUncertainMutationOutcome,
  isDeniedDomainRead,
  isUnsettledScheduleRun,
} from "./agents-schedules-mutation-safety";

describe("Agent, Skill and Schedule write outcomes", () => {
  it.each([400, 401, 403, 404, 409])(
    "allows correction after an acknowledged transactional refusal (%s)",
    async (status) => {
      const error = await read({
        ok: false,
        status,
        json: async () => ({ error: "fixture_refusal" }),
      }).catch((error) => error);
      expect(hasUncertainMutationOutcome(error)).toBe(false);
    },
  );

  it.each([500, 502, 503])(
    "blocks repeating a non-idempotent create after a server failure (%s)",
    async (status) => {
      const error = await read({
        ok: false,
        status,
        json: async () => ({ error: "fixture_failure" }),
      }).catch((error) => error);
      expect(hasUncertainMutationOutcome(error)).toBe(true);
    },
  );

  it("treats a lost HTTP acknowledgement as uncertain", async () => {
    const error = await Promise.reject(new TypeError("Failed to fetch")).catch(
      (error) => error,
    );
    expect(hasUncertainMutationOutcome(error)).toBe(true);
  });

  it("treats an undecodable success response as uncertain", async () => {
    const error = await read({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Truncated response");
      },
    }).catch((error) => error);
    expect(hasUncertainMutationOutcome(error)).toBe(true);
  });
});

describe("Schedule Run admission fence", () => {
  it.each(["queued", "launching", "running", "uncertain"] as const)(
    "keeps %s fenced and observed",
    (state) => {
      expect(isUnsettledScheduleRun(state)).toBe(true);
    },
  );
  it.each(["finished", "failed", "interrupted"] as const)(
    "recognizes %s as settled",
    (state) => {
      expect(isUnsettledScheduleRun(state)).toBe(false);
    },
  );
});

describe("Authoritative domain read revocation", () => {
  it.each([401, 403, 404])(
    "hides retained TanStack bytes after a %s refetch",
    async (status) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const queryKey = ["workspace", "fixture", "skill", "fixture"];
      await queryClient.fetchQuery({
        queryKey,
        queryFn: async () => ({ instructions: "private fixture instructions" }),
      });
      await queryClient.invalidateQueries({ queryKey });
      await queryClient
        .fetchQuery({
          queryKey,
          queryFn: async () =>
            read({
              ok: false,
              status,
              json: async () => ({ error: "fixture_revocation" }),
            }),
        })
        .catch(() => undefined);
      const state = queryClient.getQueryState(queryKey);
      expect(state?.data).toEqual({
        instructions: "private fixture instructions",
      });
      expect(isDeniedDomainRead(state?.error)).toBe(true);
      queryClient.clear();
    },
  );
  it("distinguishes a transient read failure from authority denial", () => {
    expect(isDeniedDomainRead(new TypeError("Failed to fetch"))).toBe(false);
  });
});
