import { AuthSessionId, BotId } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import { groupRosterContext } from "./groupResponder.ts";

const axo = { id: BotId.make("bot-axo"), name: "Axo" };

const capy = { id: BotId.make("bot-capy"), name: "Capy" };

describe("groupRosterContext", () => {
  it("lists every member with its role, marks the responder, and explains when to reply", () => {
    const context = groupRosterContext({
      groupName: "Mates",
      members: [
        { kind: "bot", botId: axo.id, role: "boss" },
        { kind: "bot", botId: capy.id, role: "specialist" },
        { kind: "person", personId: AuthSessionId.make("person-ana"), displayName: "Ana" },
      ],
      respondingBotId: capy.id,
      bots: new Map([
        [axo.id, { name: axo.name, role: "Writes  the launch copy\n and ads." }],
        [capy.id, { name: capy.name, role: null }],
      ]),
    });

    expect(context).toContain('group chat "Mates"');
    expect(context).toContain("- Axo (bot): Writes the launch copy and ads.");
    expect(context).toContain("- Capy (bot, you)\n");
    expect(context).toContain("- Ana (person)");
    expect(context).toContain("reply exactly NO_REPLY");
    expect(context).toContain("No bot leads this group");
    expect(context).toContain("Greetings and small talk");
    expect(context).toContain("Stay out when another bot already took it");
    expect(context).not.toMatch(/\(lead\)|boss/i);
  });
});
