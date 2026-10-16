import * as Predicate from "effect/Predicate";
import { RequestContext } from "@mastra/core/request-context";
import * as DateTime from "effect/DateTime";
import {
  createOttoAgentInstructions,
  createOttoBotInstructions,
} from "../otto-agent-instructions.ts";
import { controllerContext } from "./otto-memory.ts";

export function resolveOttoInstructions(
  requestContext: RequestContext,
  now = DateTime.nowUnsafe(),
): string {
  const state = controllerContext(requestContext)?.state;

  const isBotConversation =
    Predicate.isObjectOrArray(state) &&
    state !== null &&
    "botConversation" in state &&
    state.botConversation === true;

  const name =
    isBotConversation && "botName" in state && Predicate.isString(state.botName)
      ? state.botName
      : "Otto";

  const instructions =
    isBotConversation && "botInstructions" in state && Predicate.isString(state.botInstructions)
      ? state.botInstructions
      : undefined;

  const botPrompt = isBotConversation
    ? createOttoBotInstructions({
        name,
        now,
        ...(instructions ? { instructions } : {}),
      })
    : createOttoAgentInstructions({
        name,
        now,
        ...(instructions ? { instructions } : {}),
      });

  const persistentMemoryContext =
    Predicate.isObjectOrArray(state) &&
    state !== null &&
    "persistentMemoryContext" in state &&
    Predicate.isString(state.persistentMemoryContext)
      ? state.persistentMemoryContext
      : "";

  const mcpInstructions =
    Predicate.isObjectOrArray(state) &&
    state !== null &&
    "mcpInstructions" in state &&
    Predicate.isString(state.mcpInstructions)
      ? state.mcpInstructions
      : "";

  const skillsContext =
    Predicate.isObjectOrArray(state) &&
    state !== null &&
    "skillsContext" in state &&
    Predicate.isString(state.skillsContext)
      ? state.skillsContext
      : "";

  const groupContext =
    isBotConversation && "groupContext" in state && Predicate.isString(state.groupContext)
      ? state.groupContext
      : "";

  const projectContext =
    isBotConversation && "projectContext" in state && Predicate.isString(state.projectContext)
      ? state.projectContext
      : "";

  return [
    botPrompt,
    projectContext,
    groupContext,
    mcpInstructions,
    skillsContext,
    persistentMemoryContext,
  ]
    .filter(Boolean)
    .join("\n\n");
}
