import { expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import { remoteDoctorHome } from "./remote-doctor.ts";

it("never resolves the remote doctor home from an ambient OTTO_LEGACY_HOME", () => {
  expect(
    remoteDoctorHome(Option.none(), { OTTO_LEGACY_HOME: "/home/user/.ottoLegacy" }),
  ).toBeUndefined();
  expect(
    remoteDoctorHome(Option.none(), {
      OTTO_LEGACY_HOME: "/home/user/.ottoLegacy",
      OTTO_HOME: "/srv/otto",
    }),
  ).toBe("/srv/otto");
  expect(
    remoteDoctorHome(Option.some("/explicit"), {
      OTTO_LEGACY_HOME: "/home/user/.ottoLegacy",
      OTTO_HOME: "/srv/otto",
    }),
  ).toBe("/explicit");
});
