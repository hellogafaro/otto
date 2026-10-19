import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import { decodePersistedDesktopTabs } from "./desktop-tabs-store";

describe("decodePersistedDesktopTabs", () => {
  it("still reads tabs saved before history existed", () => {
    const decoded = decodePersistedDesktopTabs({
      tabs: [{ id: "tab-1", href: "/chats/thread-1" }],
      activeId: "tab-1",
      titles: { "/chats/thread-1": "Lenny" },
    });

    expect(Option.isSome(decoded)).toBe(true);

    if (Option.isNone(decoded)) return;

    expect(decoded.value.tabs[0]).toMatchObject({ id: "tab-1", href: "/chats/thread-1" });
    expect(decoded.value.titles["/chats/thread-1"]).toBe("Lenny");
  });
});
