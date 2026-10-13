import { AuthSessionId, BotId } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import { groupMentions, groupRosterContext, groupRound } from "./groupResponder.ts";

const axo = { id: BotId.make("bot-axo"), name: "Axo" };

const capy = { id: BotId.make("bot-capy"), name: "Capy" };

const icon = { id: BotId.make("bot-icon"), name: "Icon Preview" };

const bots = [axo, capy, icon];

describe("groupRound", () => {
  it.each([
    ["what should we build next?", [axo.id, capy.id, icon.id], "plain"],
    ["@Capy can you check this?", [capy.id], "mentioned"],
    ["@capy then @Axo, please", [capy.id, axo.id], "mentioned"],
    [`ask @bot:${icon.id} for icons`, [icon.id], "mentioned"],
    ["@Icon Preview make one", [icon.id], "mentioned"],
    ["@everyone status update please", [axo.id, capy.id, icon.id], "everyone"],
    ["@everyone and @Capy", [axo.id, capy.id, icon.id], "everyone"],
    ["email me at axo@capy.ai", [axo.id, capy.id, icon.id], "plain"],
    ["@Capyz is not a member", [axo.id, capy.id, icon.id], "plain"],
  ] as const)("routes %j", (text, botIds, reason) => {
    expect(groupRound(bots, text)).toEqual({ botIds, reason });
  });
});

describe("groupMentions", () => {
  it("finds names followed by punctuation and ignores bots not listed", () => {
    expect(groupMentions([capy, icon], "Thanks @Axo. @Capy, take the API part!")).toEqual([
      capy.id,
    ]);
  });
});

describe("groupRosterContext", () => {
  it("lists every member, marks the responder, and explains NO_REPLY without a lead", () => {
    const context = groupRosterContext({
      groupName: "Mates",
      members: [
        { kind: "bot", botId: axo.id, role: "boss" },
        { kind: "bot", botId: capy.id, role: "specialist" },
        { kind: "person", personId: AuthSessionId.make("person-ana"), displayName: "Ana" },
      ],
      respondingBotId: capy.id,
      botNames: new Map([
        [axo.id, axo.name],
        [capy.id, capy.name],
      ]),
    });

    expect(context).toContain('group chat "Mates"');
    expect(context).toContain("- Axo (bot)");
    expect(context).toContain("- Capy (bot, you)");
    expect(context).toContain("- Ana (person)");
    expect(context).toContain("reply exactly NO_REPLY");
    expect(context).toContain("No bot leads this group");
    expect(context).not.toMatch(/\(lead\)|boss/i);
  });
  it("keeps every bot quiet when a message only mentions a person", () => {
    const bots = [
      { id: BotId.make("bot-axo"), name: "Axo" },
      { id: BotId.make("bot-capy"), name: "Capy" },
    ];

    expect(groupRound(bots, "@Ana can you check this?", ["Ana Lopez"]).botIds).toEqual([]);
    expect(groupRound(bots, "@Ana Lopez and @Capy, thoughts?", ["Ana Lopez"]).botIds).toEqual([
      BotId.make("bot-capy"),
    ]);
    expect(groupRound(bots, "hello", ["Ana Lopez"]).botIds).toHaveLength(2);
  });
});
