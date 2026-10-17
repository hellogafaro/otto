import { describe, expect, it } from "vite-plus/test";

import { BotId } from "@otto/contracts";
import { findDelegationTarget } from "./otto-delegation-policy.ts";

const bot = (id: string, name: string, archivedAt: string | null = null) => ({
  id: BotId.make(id),
  name,
  archivedAt,
});

describe("findDelegationTarget", () => {
  const bots = [bot("b-juno", "Juno"), bot("b-nova", "Nova"), bot("b-old", "Old", "2026-01-01")];

  it("finds a bot by id first", () => {
    expect(findDelegationTarget(bots, "b-nova")?.id).toBe("b-nova");
  });

  it("finds a live bot by its exact name, ignoring case and a leading @", () => {
    expect(findDelegationTarget(bots, "juno")?.id).toBe("b-juno");
    expect(findDelegationTarget(bots, "@Juno")?.id).toBe("b-juno");
  });

  it("refuses archived, unknown and ambiguous names", () => {
    expect(findDelegationTarget(bots, "Old")).toBeUndefined();
    expect(findDelegationTarget(bots, "Zed")).toBeUndefined();
    expect(findDelegationTarget([...bots, bot("b-juno-2", "Juno")], "Juno")).toBeUndefined();
  });
});
