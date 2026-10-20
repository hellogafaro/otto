import { describe, expect, it } from "vite-plus/test";

import {
  linkMentionTags,
  mentionChannelText,
  mentionMarkdown,
  mentionPath,
  mentionPlainText,
  mentionTag,
  mentionText,
  parseMentionHref,
  resolveBotMentions,
} from "./mention.ts";

const labelOf = (mention: { readonly type: string; readonly id: string }) => {
  if (mention.type === "person" && mention.id === "user-ada") return "Ada";

  if (mention.type === "task" && mention.id === "task-1") return "Launch";

  if (mention.type === "library" && mention.id === "file-1") return "Brief";

  return undefined;
};

describe("resolveBotMentions", () => {
  it("keeps a tag for something that exists and escapes everything else", () => {
    expect(
      resolveBotMentions(
        'Done <b>soon</b>, <mention type="person" id="user-ada">whoever</mention> ' +
          '<mention type="task" id="missing">Nope</mention> ' +
          '<mention type="bot" id="bot-nova">Nova</mention>',
        labelOf,
      ),
    ).toBe(
      'Done &lt;b&gt;soon&lt;/b&gt;, <mention type="person" id="user-ada">Ada</mention> ' +
        '&lt;mention type="task" id="missing"&gt;Nope&lt;/mention&gt; ' +
        '&lt;mention type="bot" id="bot-nova"&gt;Nova&lt;/mention&gt;',
    );
  });

  it("writes the current title, not the label the bot invented", () => {
    expect(
      resolveBotMentions(
        '<mention type="library" id="file-1">Old name</mention> and <mention type="task" id="task-1">x</mention>',
        labelOf,
      ),
    ).toBe(
      '<mention type="library" id="file-1">Brief</mention> and <mention type="task" id="task-1">Launch</mention>',
    );
  });
});

describe("mention text", () => {
  const stored = 'See <mention type="task" id="task-1">Launch &amp; go</mention> &lt;now&gt;';

  it("shows a bot the tag it should paste", () => {
    expect(mentionText(stored)).toBe(
      'See <mention type="task" id="task-1">Launch &amp; go</mention> <now>',
    );
  });

  it("shows a person the name", () => {
    expect(mentionPlainText(stored)).toBe("See @Launch & go <now>");
  });

  it("turns a stored mention into a link, and a chat mention outside code into the same link", () => {
    expect(mentionMarkdown(stored)).toBe("See [Launch & go](#mention/task/task-1) <now>");
    expect(parseMentionHref("#mention/task/task-1")).toEqual({ type: "task", id: "task-1" });
    expect(
      linkMentionTags(
        'Use <mention type="project" id="p-1">Launch</mention> `not <mention type="task" id="t">T</mention>`',
      ),
    ).toBe('Use [Launch](#mention/project/p-1) `not <mention type="task" id="t">T</mention>`');
  });
});

describe("mentionChannelText", () => {
  const text =
    'See <mention type="task" id="task-1">Launch</mention> `not <mention type="task" id="t">T</mention>`';

  it("links a task only when the server has a public origin", () => {
    expect(mentionPath("task", "task-1")).toBe("/tasks/task-1");
    expect(mentionChannelText(text, undefined, false)).toBe(
      'See @Launch `not <mention type="task" id="t">T</mention>`',
    );
    expect(mentionChannelText(text, "https://otto.example", true)).toBe(
      'See [Launch](https://otto.example/tasks/task-1) `not <mention type="task" id="t">T</mention>`',
    );
    expect(mentionChannelText(text, "https://otto.example/", false)).toBe(
      'See Launch https://otto.example/tasks/task-1 `not <mention type="task" id="t">T</mention>`',
    );
  });
});

describe("mentionTag", () => {
  it("escapes a label that would close the tag", () => {
    expect(mentionTag({ type: "task", id: "task-1", label: 'A <b> & "c"' })).toBe(
      '<mention type="task" id="task-1">A &lt;b&gt; &amp; "c"</mention>',
    );
  });
});
