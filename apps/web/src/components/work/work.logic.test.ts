import { describe, expect, it } from "vite-plus/test";

import { parseProjectSearch, parseTaskSearch, projectCover } from "./work.logic";

describe("parseTaskSearch", () => {
  it("reads every filter from the URL", () => {
    expect(
      parseTaskSearch({
        project: "launch",
        owner: "person:ada",
        assignee: "bot:scout",
        status: "pending,in_progress",
        dueFrom: "2026-03-01",
        dueTo: "2026-03-31",
      }),
    ).toEqual({
      project: "launch",
      owner: "person:ada",
      assignee: "bot:scout",
      status: ["pending", "in_progress"],
      dueFrom: "2026-03-01",
      dueTo: "2026-03-31",
    });
  });

  it("ignores unknown params and falls back to no filter on a malformed one", () => {
    expect(parseTaskSearch({ status: "archived", extra: "x" })).toEqual({ status: ["archived"] });
    expect(parseTaskSearch({ owner: "ada" })).toEqual({});
    expect(parseTaskSearch({ status: "done" })).toEqual({});
    expect(parseTaskSearch({ dueTo: "next week" })).toEqual({});
  });
});

describe("parseProjectSearch", () => {
  it("keeps only owner and status", () => {
    expect(parseProjectSearch({ owner: "bot:scout", status: "archived", project: "x" })).toEqual({
      owner: "bot:scout",
      status: ["archived"],
    });
  });
});

describe("projectCover", () => {
  it("is stable per seed", () => {
    expect(projectCover("launch")).toEqual(projectCover("launch"));
  });
});
