import { getChatAttention } from "@otto/chats";
import { getOperations } from "@otto/connections";
import { getRunQuestions, getRuns } from "@otto/runs";
import { type Context, requireHuman } from "@otto/workspaces";

/** Composes current authorized records; each bounded collection keeps its own pagination position. */
export async function getAttention(
  c: Context,
  filter: {
    after?: string;
    limit?: number;
    mentionsOnly?: boolean;
    runAfter?: string;
    questionAfter?: string;
    operationAfter?: string;
  },
) {
  requireHuman(c);
  const messages = await getChatAttention(c, filter);
  const runs = await getRuns(c, {
    after: filter.runAfter,
    limit: filter.limit,
  });
  const questions = await getRunQuestions(c, {
    after: filter.questionAfter,
    limit: filter.limit,
  });
  const approvals = await getOperations(c, {
    state: "awaiting_approval",
    after: filter.operationAfter,
    limit: filter.limit,
  });
  return {
    ...messages,
    runs,
    questions,
    approvals,
  };
}
