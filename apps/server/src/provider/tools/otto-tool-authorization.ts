import * as Predicate from "effect/Predicate";
import { type OttoToolId } from "@otto/contracts";

export function field<Value>(value: Value, key: string) {
  if (!Predicate.isObjectOrArray(value) || value === null) return undefined;

  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

export function requiredString<Value>(value: Value, key: string): string {
  const candidate = field(value, key);

  if (!Predicate.isString(candidate) || candidate.length === 0) {
    throw new Error(`Tool input field '${key}' is required.`);
  }

  return candidate;
}

export function canonicalInput<Value>(value: Value): string {
  if (Array.isArray(value)) return `[${value.map(canonicalInput).join(",")}]`;

  if (Predicate.isObjectOrArray(value) && value !== null) {
    return `{${Object.keys(value)
      .filter((key) => field(value, key) !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalInput(field(value, key))}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
}

export function ensureWorkspaceCwd<Input>(toolId: OttoToolId, input: Input): void {
  if (toolId !== "shell") return;
  const cwd = field(input, "cwd");

  if (cwd === undefined) return;

  if (!Predicate.isString(cwd)) throw new Error(`Tool '${toolId}' cwd must be a relative path.`);

  if (
    cwd.startsWith("/") ||
    cwd.startsWith("\\") ||
    /^[A-Za-z]:/.test(cwd) ||
    cwd.split(/[\\/]+/).includes("..")
  ) {
    throw new Error(`Tool '${toolId}' cwd must stay inside its workspace.`);
  }
}
