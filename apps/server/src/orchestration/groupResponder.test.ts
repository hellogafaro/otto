import { AuthSessionId, BotId } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import { groupRosterContext } from "./groupResponder.ts";

const axo = { id: BotId.make("bot-axo"), name: "Axo" };

const capy = { id: BotId.make("bot-capy"), name: "Capy" };

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
});
