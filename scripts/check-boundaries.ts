import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Rerunnable first-party boundary check: manifests match imports and internal domains form a DAG. */
const root = new URL("../", import.meta.url).pathname;
const graph = new Map<string, Set<string>>();
for (const entry of await readdir(join(root, "packages"))) {
  const file = Bun.file(join(root, "packages", entry, "package.json"));
  if (!(await file.exists())) continue;
  const manifest: unknown = await file.json();
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !("name" in manifest) ||
    typeof manifest.name !== "string"
  )
    throw new Error(`Invalid manifest: ${entry}`);
  const dependencies =
    "dependencies" in manifest &&
    manifest.dependencies &&
    typeof manifest.dependencies === "object"
      ? Object.keys(manifest.dependencies)
      : [];
  graph.set(
    manifest.name,
    new Set(dependencies.filter((name) => name.startsWith("@otto/"))),
  );
  for await (const path of new Bun.Glob("**/*.ts").scan({
    cwd: join(root, "packages", entry, "src"),
    absolute: true,
  })) {
    const source = await Bun.file(path).text();
    for (const match of source.matchAll(/from\s+["'](@otto\/[^"']+)["']/g)) {
      const name = match[1];
      if (!name) continue;
      if (name.endsWith("/schema"))
        throw new Error(`Private schema dependency: ${path}`);
      if (!dependencies.includes(name))
        throw new Error(`Undeclared domain dependency ${name}: ${path}`);
    }
  }
}
function visit(name: string, path: string[]) {
  if (path.includes(name))
    throw new Error(`Domain dependency cycle: ${[...path, name].join(" -> ")}`);
  for (const next of graph.get(name) ?? []) visit(next, [...path, name]);
}
for (const name of graph.keys()) visit(name, []);
console.log(
  `Verified ${graph.size} packages: declared domain imports, no private schema imports or dependency cycles`,
);
