import { describe, expect, it } from "vite-plus/test";

import { isAlmostFull, memoryEntryMeta, memoryErrorMessage } from "./bot-memory-sheet";

const i18n = {
  t: (key: string) => key,
  formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(value),
};

const names = {
  currentPersonId: "person-ana",
  bots: new Map([["bot-juno", "Juno"]]),
  people: new Map([["person-icon", "Icon"]]),
};

describe("BotMemorySheet", () => {
  it("names the writer, the source chat and the date of an entry", () => {
    const entry = { threadTitle: "Launch plan", updatedAt: "2026-10-16T09:00:00.000Z" };

    expect(
      memoryEntryMeta({ ...entry, botId: "bot-juno", personId: "person-ana" }, names, i18n),
    ).toBe("Juno · Launch plan · Oct 16");
    expect(
      memoryEntryMeta(
        { ...entry, botId: null, personId: "person-ana", threadTitle: null },
        names,
        i18n,
      ),
    ).toBe("You · Oct 16");
    expect(memoryEntryMeta({ ...entry, botId: null, personId: "person-icon" }, names, i18n)).toBe(
      "Icon · Launch plan · Oct 16",
    );
  });

  it("calls a scope almost full at 90% of its cap", () => {
    expect(isAlmostFull({ used: 1_349, cap: 1_500 })).toBe(false);
    expect(isAlmostFull({ used: 1_350, cap: 1_500 })).toBe(true);
  });

  it("keeps server failures and falls back for unknown errors", () => {
    expect(memoryErrorMessage(new Error("The person memory is full."))).toBe(
      "The person memory is full.",
    );
    expect(memoryErrorMessage(null)).toBeNull();
  });
});
