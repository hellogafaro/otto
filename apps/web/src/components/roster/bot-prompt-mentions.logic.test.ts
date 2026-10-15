import { describe, expect, it } from "vite-plus/test";

import {
  applyBotPromptMention,
  botPromptMentionTrigger,
  botPromptThreadQuery,
  buildBotPromptMentionItems,
  findNameMentions,
  serializeBotPromptMentions,
} from "./bot-prompt-mentions.logic";

const bots = [{ id: "bot-1", name: "Mika" }];

const threads = [{ id: "thread-2", title: "Release plan" }];

describe("botPromptMentionTrigger", () => {
  it("opens for an @ token at the caret and stays closed otherwise", () => {
    expect(botPromptMentionTrigger("check @bro", 10)).toEqual({
      query: "bro",
      rangeStart: 6,
      rangeEnd: 10,
    });
    expect(botPromptMentionTrigger("check @", 7)?.query).toBe("");
    expect(botPromptMentionTrigger("check @chat:rel", 17)?.query).toBe("chat:rel");
    expect(botPromptMentionTrigger("check this", 10)).toBeNull();
    expect(botPromptMentionTrigger("use $skill", 10)).toBeNull();
    expect(botPromptMentionTrigger("/model", 6)).toBeNull();
    expect(botPromptMentionTrigger('open @"my file', 14)).toBeNull();
  });

  it("strips the thread prefix for chat matching", () => {
    expect(botPromptThreadQuery("chat:rel")).toBe("rel");
    expect(botPromptThreadQuery("rel")).toBe("rel");
  });
});

describe("buildBotPromptMentionItems", () => {
  it("offers @everyone only in group chats", () => {
    const group = buildBotPromptMentionItems({
      query: "ev",
      browserAvailable: false,
      everyone: true,
      bots,
      threads,
    });

    expect(group[0]).toEqual({ kind: "everyone", key: "everyone", label: "everyone" });
    expect(
      applyBotPromptMention("hi @ev", { query: "ev", rangeStart: 3, rangeEnd: 6 }, group[0]!).text,
    ).toBe("hi @everyone ");
    expect(
      buildBotPromptMentionItems({ query: "ev", browserAvailable: false, bots, threads }).some(
        (item) => item.kind === "everyone",
      ),
    ).toBe(false);
  });

  it("offers the browser only when browser access is on", () => {
    const enabled = buildBotPromptMentionItems({
      query: "",
      browserAvailable: true,
      bots,
      threads,
    });

    expect(enabled.map((item) => item.kind)).toEqual(["browser", "bot", "thread"]);

    const gated = buildBotPromptMentionItems({ query: "", browserAvailable: false, bots, threads });
    expect(gated.some((item) => item.kind === "browser")).toBe(false);
  });

  it("finds the browser by its displayed name", () => {
    const items = buildBotPromptMentionItems({
      query: "浏览",
      browserAvailable: true,
      browserLabel: "浏览器",
      bots,
      threads,
    });

    expect(items[0]?.kind).toBe("browser");
  });

  it("filters by query and keeps @chat: to chats", () => {
    expect(
      buildBotPromptMentionItems({ query: "bro", browserAvailable: true, bots, threads: [] }),
    ).toEqual([{ kind: "browser", key: "browser", label: "Browser" }]);
    expect(
      buildBotPromptMentionItems({ query: "chat:", browserAvailable: true, bots, threads }).map(
        (item) => item.kind,
      ),
    ).toEqual(["thread"]);
  });

  it("carries whether each bot can take handed-off work", () => {
    const items = buildBotPromptMentionItems({
      query: "",
      browserAvailable: false,
      bots: [
        { id: "bot-1", name: "Mika" },
        { id: "bot-2", name: "Legacy", canTakeWork: false },
      ],
      threads: [],
    });

    expect(
      items.map((item) => (item.kind === "bot" ? [item.label, item.canTakeWork] : null)),
    ).toEqual([
      ["Mika", true],
      ["Legacy", false],
    ]);
  });

  it("matches bots by name prefix, like the browser", () => {
    const named = [
      { id: "bot-1", name: "Mika" },
      { id: "bot-2", name: "Tamika" },
    ];

    expect(
      buildBotPromptMentionItems({
        query: "mi",
        browserAvailable: false,
        bots: named,
        threads: [],
      }).map((item) => item.label),
    ).toEqual(["Mika"]);
  });

  it("gives a bot named browser its id token instead of the browser mention", () => {
    const [item] = buildBotPromptMentionItems({
      query: "brow",
      browserAvailable: false,
      bots: [{ id: "bot-browser", name: "browser" }],
      threads: [],
    });

    expect(item).toMatchObject({ kind: "bot" });
    expect(item && "source" in item ? item.source : null).not.toBe("@browser");
  });

  it("lists every bot that shares a name, told apart by title or short id", () => {
    const namesakes = [
      { id: "bot-claude-1", name: "Mika", title: "Designer" },
      { id: "bot-grok-2", name: "Mika", title: "Reviewer" },
      { id: "bot-3", name: "Mila", title: "Writer" },
    ];

    const items = buildBotPromptMentionItems({
      query: "mi",
      browserAvailable: false,
      bots: namesakes,
      threads: [],
    });

    expect(items.map((item) => (item.kind === "bot" ? [item.label, item.detail] : null))).toEqual([
      ["Mika", "Designer"],
      ["Mika", "Reviewer"],
      ["Mila", null],
    ]);

    const sameTitle = namesakes.map((bot) => ({ ...bot, title: "Designer" }));
    expect(
      buildBotPromptMentionItems({
        query: "mika",
        browserAvailable: false,
        bots: sameTitle,
        threads: [],
      }).map((item) => (item.kind === "bot" ? item.detail : null)),
    ).toEqual(["#aude-1", "#grok-2"]);
  });

  it("inserts an exact-bot token for a shared name and @Name otherwise", () => {
    const namesakes = [
      { id: "bot-1", name: "Mika", title: "Designer" },
      { id: "bot-2", name: "Mika", title: "Reviewer" },
      { id: "bot-3", name: "Mila" },
    ];

    const trigger = botPromptMentionTrigger("ask @mi", 7)!;

    const items = buildBotPromptMentionItems({
      query: trigger.query,
      browserAvailable: false,
      bots: namesakes,
      threads: [],
    });

    expect(items.map((item) => applyBotPromptMention("ask @mi", trigger, item).text)).toEqual([
      "ask @bot:bot-1 ",
      "ask @bot:bot-2 ",
      "ask @Mila ",
    ]);
  });

  it("lists workspace files after the mentions", () => {
    const items = buildBotPromptMentionItems({
      query: "re",
      browserAvailable: true,
      bots,
      threads,
      paths: [{ path: "docs/release.md" }],
    });

    expect(items.map((item) => item.kind)).toEqual(["thread", "path"]);
    expect(items[1]).toMatchObject({ label: "release.md", directory: "docs" });
  });

  it("puts the file first when a path query matches no mention by name", () => {
    // Chat search also matches message text, so a chat can rank for "src/comp".
    const contentMatch = [{ id: "thread-3", title: "Refactor review" }];

    const items = buildBotPromptMentionItems({
      query: "src/comp",
      browserAvailable: true,
      bots,
      threads: contentMatch,
      paths: [{ path: "src/components/App.tsx" }, { path: "src/compat.ts" }],
    });

    expect(items.map((item) => item.kind)).toEqual(["path", "path"]);

    const titled = buildBotPromptMentionItems({
      query: "v1.2",
      browserAvailable: true,
      bots,
      threads: [{ id: "thread-4", title: "Ship v1.2" }],
      paths: [],
    });

    expect(titled.map((item) => item.label)).toEqual(["Ship v1.2"]);
  });

  it("skips files for an explicit @chat: query", () => {
    expect(
      buildBotPromptMentionItems({
        query: "chat:src",
        browserAvailable: true,
        bots,
        threads,
        paths: [{ path: "src/a.ts" }],
      }).map((item) => item.kind),
    ).toEqual(["thread"]);
  });
});

describe("applyBotPromptMention", () => {
  it("replaces the typed query with the token and a trailing space", () => {
    const trigger = botPromptMentionTrigger("check @rel now", 10)!;

    const [thread] = buildBotPromptMentionItems({
      query: "rel",
      browserAvailable: false,
      bots: [],
      threads,
    });

    expect(applyBotPromptMention("check @rel now", trigger, thread!)).toEqual({
      text: "check @Release plan now",
      caret: 20,
    });

    const browserTrigger = botPromptMentionTrigger("@b", 2)!;
    expect(
      applyBotPromptMention("@b", browserTrigger, {
        kind: "browser",
        key: "browser",
        label: "Browser",
      }).text,
    ).toBe("@browser ");

    const pathTrigger = botPromptMentionTrigger("open @src/comp", 14)!;

    const [file] = buildBotPromptMentionItems({
      query: pathTrigger.query,
      browserAvailable: true,
      bots,
      threads: [],
      paths: [{ path: "src/components/App.tsx" }],
    });

    expect(applyBotPromptMention("open @src/comp", pathTrigger, file!).text).toBe(
      "open [App.tsx](src/components/App.tsx) ",
    );
  });
});

describe("readable mentions", () => {
  const names = [
    { name: "Mika" },
    { name: "Release plan", source: "@chat:thread-2" },
    { name: "Release", source: "@chat:thread-3" },
  ];

  it("finds whole @names, longest first, at word boundaries", () => {
    expect(
      findNameMentions("@mika, see @Release plan. mail a@Mika or @Mikael", names).map(
        (mention) => mention.name,
      ),
    ).toEqual(["Mika", "Release plan"]);
  });

  it("sends each picked name as its token and leaves plain names alone", () => {
    expect(serializeBotPromptMentions("@Mika read @Release plan and @Release", names)).toBe(
      "@Mika read @chat:thread-2 and @chat:thread-3",
    );
  });
});

describe("skill, app, and MCP server mentions", () => {
  const resources = [
    { kind: "skill" as const, id: "skill-1", label: "Weekly report" },
    { kind: "app" as const, id: "googlecalendar", label: "Google Calendar" },
    { kind: "mcp" as const, id: "mcp-1", label: "DeepWiki" },
  ];

  it("offers matching resources after bots, but not for @chat: or path queries", () => {
    const labels = (query: string) =>
      buildBotPromptMentionItems({
        query,
        browserAvailable: false,
        bots,
        resources,
        threads: [],
      }).map((item) => [item.kind, item.label]);

    expect(labels("week")).toEqual([["skill", "Weekly report"]]);
    expect(labels("calendar")).toEqual([["app", "Google Calendar"]]);
    expect(labels("chat:wiki")).toEqual([]);
    expect(labels("deep/")).toEqual([]);
  });

  it("inserts the resource name and sends its token", () => {
    const [item] = buildBotPromptMentionItems({
      query: "deep",
      browserAvailable: false,
      bots,
      resources,
      threads: [],
    });

    const applied = applyBotPromptMention(
      "ask @deep",
      { query: "deep", rangeStart: 4, rangeEnd: 9 },
      item!,
    );

    expect(applied.text).toBe("ask @DeepWiki ");
    expect(
      serializeBotPromptMentions(applied.text, [{ name: "DeepWiki", source: "@mcp:mcp-1" }]),
    ).toBe("ask @mcp:mcp-1 ");
  });
});
