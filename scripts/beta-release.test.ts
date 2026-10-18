import { describe, expect, it } from "vite-plus/test";

import { planBetaRelease } from "./beta-release.ts";

const base = {
  packageVersion: "1.2.3",
  headSha: "abcdef1234567890abcdef1234567890abcdef12",
  date: "20261018",
  runNumber: "42",
} as const;

describe("beta release planning", () => {
  it("previews the next patch version with the build date and run number", () => {
    expect(planBetaRelease(base)).toEqual({
      publish: true,
      version: "1.2.4-beta.20261018.42",
      tag: "v1.2.4-beta.20261018.42",
    });
  });

  it("previews the patch after the newest stable release when main was not bumped", () => {
    expect(planBetaRelease({ ...base, latestStableVersion: "1.2.4" })).toMatchObject({
      version: "1.2.5-beta.20261018.42",
    });
    expect(planBetaRelease({ ...base, latestStableVersion: "1.1.9" })).toMatchObject({
      version: "1.2.4-beta.20261018.42",
    });
  });

  it("skips when main has not moved since the latest beta", () => {
    expect(planBetaRelease({ ...base, previousSha: base.headSha })).toEqual({
      publish: false,
    });
  });

  it("releases a newer main commit and rejects a rewritten history", () => {
    expect(
      planBetaRelease({ ...base, previousSha: "1234567890abcdef", previousIsAncestor: true }),
    ).toMatchObject({ publish: true });
    expect(() =>
      planBetaRelease({
        ...base,
        previousSha: "1234567890abcdef",
        previousIsAncestor: false,
      }),
    ).toThrow("not an ancestor");
  });

  it("rejects invalid versions, dates and run numbers", () => {
    expect(() => planBetaRelease({ ...base, packageVersion: "1.2.3-beta.1" })).toThrow(
      "Package version is invalid",
    );
    expect(() => planBetaRelease({ ...base, latestStableVersion: "1.02.3" })).toThrow(
      "Latest stable version is invalid",
    );
    expect(() => planBetaRelease({ ...base, date: "2026-10-18" })).toThrow("Beta date is invalid");
    expect(() => planBetaRelease({ ...base, runNumber: "run-1" })).toThrow(
      "Beta run number is invalid",
    );
  });
});
