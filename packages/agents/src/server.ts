import { type Context, requireHuman, requireWriter } from "@otto/workspaces";
import { and, eq } from "drizzle-orm";
import { createAgent, getAgent } from "./index";
import { agents } from "./schema";

export async function ensureDefaultAgent(c: Context) {
  requireHuman(c);
  requireWriter(c);
  const existing = (
    await c.tx
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(eq(agents.workspaceId, c.workspaceId), eq(agents.isDefault, true)),
      )
  )[0];
  if (existing) return getAgent(c, existing.id);
  const agent = await createAgent(c, {
    title: "Default agent",
    instructions: "",
    visibility: "workspace",
    model: "unconfigured",
  });
  await c.tx
    .update(agents)
    .set({ isDefault: true })
    .where(eq(agents.id, agent.id));
  return getAgent(c, agent.id);
}
