import { recordLookup } from "../record-lookup";
import type { KeybindingWhenNode } from "@otto/contracts";

export function whenAstToExpression(node: KeybindingWhenNode | undefined): string {
  if (!node) return "";

  switch (node.type) {
    case "identifier":
      return node.name;
    case "not":
      return `!${wrapWhenExpression(node.node)}`;
    case "and":
      return `${wrapWhenExpression(node.left)} && ${wrapWhenExpression(node.right)}`;
    case "or":
      return `${wrapWhenExpression(node.left)} || ${wrapWhenExpression(node.right)}`;
  }
}

function wrapWhenExpression(node: KeybindingWhenNode): string {
  if (node.type === "identifier" || node.type === "not") return whenAstToExpression(node);

  return `(${whenAstToExpression(node)})`;
}

const WHEN_VARIABLE_PHRASES = {
  previewFocus: "the preview is focused",
  modelPickerOpen: "the model picker is open",
} satisfies Readonly<Record<string, string>>;

/**
 * Plain-language summary of a when clause. Returns `null` when there is no
 * condition, and the raw expression when it is too complex to paraphrase.
 */
export function describeWhenExpression(node: KeybindingWhenNode | undefined): string | null {
  if (!node) return null;

  if (node.type === "identifier") {
    if (node.name === "true") return "Always";

    if (node.name === "false") return "Never";
    const phrase = recordLookup(WHEN_VARIABLE_PHRASES, node.name);

    return phrase ? `When ${phrase}` : `When ${node.name}`;
  }

  if (node.type === "not" && node.node.type === "identifier") {
    const phrase = recordLookup(WHEN_VARIABLE_PHRASES, node.node.name);

    return phrase ? `Unless ${phrase}` : `Unless ${node.node.name}`;
  }

  return whenAstToExpression(node);
}
