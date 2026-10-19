import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  createOttoChatContext,
  createOttoChatContextUpdate,
  createOttoInstructions,
  createOttoTurn,
} from "./otto-agent-instructions.ts";

const now = DateTime.makeUnsafe("2026-09-15T13:37:00.000Z");

describe("Otto bot instructions", () => {
  it("opens with who the bot is and where it works", () => {
    expect(createOttoInstructions({ name: "  Mina\nBot ", workspaceName: "Acme" })).toMatch(
      /^You are Mina Bot, a member of the Acme team in Otto\./,
    );
    expect(createOttoInstructions()).toMatch(/^You are Otto, a member of the team in Otto\./);
  });

  it("puts the owner's instructions after the preamble and before the tools", () => {
    const instructions = createOttoInstructions({
      instructions: "  Answer in Spanish.  ",
      tools: ["read"],
    });

    expect(instructions).toContain("<instructions>\nAnswer in Spanish.\n</instructions>");
    expect(instructions.indexOf("<instructions>")).toBeLessThan(instructions.indexOf("<tools>"));
    expect(createOttoInstructions({ instructions: "   " })).not.toContain("<instructions>");
  });

  it("lists only loaded tools, each with its own rules", () => {
    const instructions = createOttoInstructions({
      tools: ["read", "delegate", "unknown_tool"],
    });

    expect(instructions).toContain("- read: ");
    expect(instructions).toContain("- delegation (delegate): ");
    expect(instructions).toContain("Brief it like a teammate");
    expect(instructions).not.toContain("unknown_tool");
    expect(instructions).not.toContain("<computer>");
    expect(createOttoInstructions({ tools: ["shell"] })).toContain("<computer>");
    expect(createOttoInstructions({ tools: ["shell"] })).toContain(
      "never adopt or resume another chat's files or branch",
    );
    expect(createOttoInstructions({ tools: ["secret_request"] })).toContain(
      "When a command needs a credential that is not in <secrets>, ask for it with secret_request, never in a message.",
    );
    expect(instructions).not.toContain("secret_request");
    expect(
      createOttoInstructions({
        tools: ["shell"],
        coAuthor: "Co-authored-by: Nova from Otto <bot-nova@bots.otto.invalid>",
      }),
    ).toContain(
      "Your git co-author line: Co-authored-by: Nova from Otto <bot-nova@bots.otto.invalid>",
    );
  });

  it("lists a family of occasional tools in one line naming the loaded ones", () => {
    const instructions = createOttoInstructions({
      tools: ["search", "connection_read", "connection_check", "image_create"],
    });

    expect(instructions).toContain(
      "- connections (connection_read, connection_check): Find, add, check and remove the apps and MCP servers this bot can use.",
    );
    expect(instructions).toContain(
      "- images (image_create): Create images, or new images from images in this chat.",
    );
    expect(instructions.match(/connection_read/g)).toHaveLength(1);
  });

  it("keeps the shared rules without the removed follow-up rule", () => {
    const instructions = createOttoInstructions();

    expect(instructions).toContain("Direct and friendly, never performative");
    expect(instructions).toContain("NO_REPLY");
    expect(instructions).not.toContain("No follow-up questions or offers");
    expect(instructions).not.toContain("Prefer preview_* tools over browser_* tools");
    expect(instructions).not.toContain("<personality>");
  });

  it("adds skills and MCP guidance as their own sections", () => {
    const instructions = createOttoInstructions({
      skills: "- Weekly report (skillId: s1): Writes the weekly report",
      mcpInstructions: "- Docs (docs): Search first.",
    });

    expect(instructions).toContain(
      "<available_skills>\n- Weekly report (skillId: s1): Writes the weekly report\n</available_skills>",
    );
    expect(instructions).toContain("<mcp_servers>\n- Docs (docs): Search first.\n</mcp_servers>");
  });

  it("keeps the static prompt compact", () => {
    expect(createOttoInstructions().length).toBeLessThan(2_000);
  });
});

describe("Otto chat context", () => {
  it("tags each non-empty section", () => {
    expect(
      createOttoChatContext({ workspace: "People: Ana", project: " ", memory: "Likes tea" }),
    ).toBe("<workspace>\nPeople: Ana\n</workspace>\n\n<memory>\nLikes tea\n</memory>");
    expect(
      createOttoChatContext({ chat: "Mina", secrets: "STRIPE_KEY", memory: "Likes tea" }),
    ).toBe(
      "<chat>\nMina\n</chat>\n\n<secrets>\nSTRIPE_KEY\n</secrets>\n\n<memory>\nLikes tea\n</memory>",
    );
  });

  it("marks removed sections as empty in an update", () => {
    expect(
      createOttoChatContextUpdate([
        ["project", "Launch"],
        ["chat", ""],
      ]),
    ).toBe(
      "<context_update>\nThese sections replace the ones sent earlier.\n<project>\nLaunch\n</project>\n<chat />\n</context_update>",
    );
  });

  it("lists memory changes line by line while what memory says stays the same", () => {
    const previous = { memory: "Shared chat.\n- [m_1] Ben likes tea.\n- [m_2] Ships on Fridays." };

    expect(
      createOttoChatContextUpdate(
        [["memory", "Shared chat.\n- [m_1] Ben likes coffee.\n- [m_3] Mai runs QA."]],
        previous,
      ),
    ).toBe(
      "<memory_changes>\n- updated [m_1] Ben likes coffee.\n- added [m_3] Mai runs QA.\n- deleted [m_2]\n</memory_changes>",
    );

    expect(
      createOttoChatContextUpdate([["memory", "Private chat.\n- [m_1] Ben likes tea."]], previous),
    ).toBe(
      "<context_update>\nThese sections replace the ones sent earlier.\n<memory>\nPrivate chat.\n- [m_1] Ben likes tea.\n</memory>\n</context_update>",
    );
  });
});

describe("Otto turn block", () => {
  it("states the local date and time and carries the turn notes", () => {
    expect(createOttoTurn({ now, timezone: "Europe/Madrid" })).toBe(
      '<turn date="Tuesday, September 15, 2026" time="15:37" timezone="Europe/Madrid" />',
    );
    expect(createOttoTurn({ now, timezone: "Europe/Madrid", notes: " Your turn. " })).toBe(
      '<turn date="Tuesday, September 15, 2026" time="15:37" timezone="Europe/Madrid">\nYour turn.\n</turn>',
    );
  });

  it("falls back to UTC for an unknown timezone", () => {
    expect(createOttoTurn({ now, timezone: "Not/AZone" })).toBe(
      '<turn date="Tuesday, September 15, 2026" time="13:37" timezone="UTC" />',
    );
  });
});
