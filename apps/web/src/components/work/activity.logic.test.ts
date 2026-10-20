import { describe, expect, it } from "vite-plus/test";

import {
  activityEditDraft,
  type MentionTarget,
  parseActivityContent,
  toActivityContent,
  activityMarkdown,
  parseMentionHref,
} from "./activity.logic";

const targets: ReadonlyArray<MentionTarget> = [
  { type: "person", id: "session-ana", label: "Ana Lopez" },
  { type: "person", id: "session-an", label: "Ana" },
  { type: "bot", id: "bot-nova", label: "Nova" },
];

describe("toActivityContent", () => {
  it("tags known people and bots, preferring the longest name", () => {
    expect(toActivityContent("@Ana Lopez and @nova, take a look", targets)).toBe(
      '<mention type="person" id="session-ana">Ana Lopez</mention> and ' +
        '<mention type="bot" id="bot-nova">Nova</mention>, take a look',
    );
  });

  it("tags a bot picked by id", () => {
    expect(toActivityContent("ask @bot:bot-nova", targets)).toBe(
      'ask <mention type="bot" id="bot-nova">Nova</mention>',
    );
  });

  it("escapes typed markup and leaves unknown names and emails alone", () => {
    expect(
      toActivityContent('<mention type="bot" id="x">X</mention> ana@Nova.dev @Zed', targets),
    ).toBe('&lt;mention type="bot" id="x"&gt;X&lt;/mention&gt; ana@Nova.dev @Zed');
  });
});

describe("parseActivityContent", () => {
  it("round-trips text and mentions", () => {
    const content = toActivityContent("Hi @Ana & <team>, ping @Nova", targets);

    expect(parseActivityContent(content)).toEqual([
      expect.objectContaining({ type: "text", text: "Hi " }),
      expect.objectContaining({
        type: "mention",
        mentionType: "person",
        id: "session-an",
        label: "Ana",
      }),
      expect.objectContaining({ type: "text", text: " & <team>, ping " }),
      expect.objectContaining({
        type: "mention",
        mentionType: "bot",
        id: "bot-nova",
        label: "Nova",
      }),
    ]);
  });
});

describe("activityMarkdown", () => {
  it("keeps a comment's Markdown and turns mentions into links its renderer owns", () => {
    const content =
      '<mention type="comment" id="c-1">Nova</mention> # Plan &lt;now&gt; for <mention type="bot" id="bot-a">A [x]</mention>';

    const markdown = activityMarkdown(content);

    expect(markdown).toBe(
      "[Nova](#mention/comment/c-1) # Plan <now> for [A \\[x\\]](#mention/bot/bot-a)",
    );
    expect(parseMentionHref("#mention/bot/bot-a")).toEqual({ type: "bot", id: "bot-a" });
    expect(parseMentionHref("https://example.com")).toBeNull();
  });
});

describe("work mentions in comments", () => {
  it("stores picked tasks and projects as mention tags", () => {
    const work: ReadonlyArray<MentionTarget> = [
      ...targets,
      { type: "task", id: "task-1", label: "Draft <post>" },
      { type: "project", id: "project-1", label: "Launch" },
    ];

    expect(toActivityContent("see @task:task-1 in @project:project-1 @task:gone", work)).toBe(
      'see <mention type="task" id="task-1">Draft &lt;post&gt;</mention> in <mention type="project" id="project-1">Launch</mention> @task:gone',
    );
  });
});

describe("activityEditDraft", () => {
  it("round-trips a comment through an edit, keeping its mentions and the reply it answers", () => {
    const work: ReadonlyArray<MentionTarget> = [
      ...targets,
      { type: "task", id: "task-1", label: "Draft <post>" },
    ];

    const stored =
      '<mention type="comment" id="c-1">Ana Lopez</mention> ' +
      toActivityContent("@Ana Lopez see @task:task-1 & @nova <now>", work);

    const { prefix, draft } = activityEditDraft(stored);

    expect(prefix).toBe('<mention type="comment" id="c-1">Ana Lopez</mention> ');
    expect(draft).toBe("@Ana Lopez see @task:task-1 & @Nova <now>");
    expect((prefix + toActivityContent(draft, work)).trim()).toBe(stored);
  });
});
