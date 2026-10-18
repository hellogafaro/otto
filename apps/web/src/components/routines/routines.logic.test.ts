import { describe, expect, it } from "vite-plus/test";

import { encodeRoutineSearch, parseRoutineSearch } from "./routines.logic";

describe("parseRoutineSearch", () => {
  it("reads every filter, the sort and the order from the URL", () => {
    expect(
      parseRoutineSearch({ status: "paused,failed", bot: "nova", sort: "next", order: "desc" }),
    ).toEqual({ status: ["paused", "failed"], bot: "nova", sort: "next", order: "desc" });
  });

  it("shows the unfiltered list for a malformed URL", () => {
    expect(parseRoutineSearch({ status: "sleeping" })).toEqual({});
    expect(parseRoutineSearch({ sort: "priority" })).toEqual({});
  });

  it("writes statuses back as one comma list", () => {
    expect(encodeRoutineSearch({ status: ["active", "draft"] })).toEqual({
      status: "active,draft",
    });
  });
});
