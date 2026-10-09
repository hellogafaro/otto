import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

/** Schema references may be cyclic; business-domain operation dependencies may not. */
const root = new URL("../", import.meta.url).pathname;
const graph = new Map<string, Set<string>>();
for (const area of ["packages", "apps"]) {
  for (const entry of await readdir(join(root, area))) {
    const directory = join(root, area, entry);
    const file = Bun.file(join(directory, "package.json"));
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
    const edges = new Set<string>();
    if (area === "packages") graph.set(manifest.name, edges);
    for await (const path of new Bun.Glob("**/*.{ts,tsx}").scan({
      cwd: join(directory, "src"),
      absolute: true,
    })) {
      const schema =
        path.endsWith("/schema.ts") || path.endsWith("/content-schema.ts");
      const source = await Bun.file(path).text();
      for (const match of source.matchAll(
        /(?:from\s*|import\s*\()["']([^"']+)["']/g,
      )) {
        const specifier = match[1];
        if (!specifier) continue;
        if (specifier.startsWith(".")) {
          const target = resolve(dirname(path), specifier);
          if (relative(directory, target).startsWith("../"))
            throw new Error(
              `Relative package boundary bypass: ${path}: ${specifier}`,
            );
          continue;
        }
        if (!specifier.startsWith("@otto/")) continue;
        const name = specifier.split("/").slice(0, 2).join("/");
        if (!dependencies.includes(name))
          throw new Error(`Undeclared domain dependency ${name}: ${path}`);
        if (specifier.endsWith("/schema")) {
          // Better Auth's adapter is the one non-schema consumer of its own auth tables.
          if (
            !schema &&
            !(
              path === join(root, "apps/server/src/auth.ts") &&
              specifier === "@otto/workspaces/schema"
            )
          )
            throw new Error(`Private schema dependency: ${path}`);
        } else if (!schema) edges.add(name);
      }
    }
  }
}
function visit(name: string, path: string[]) {
  if (path.includes(name))
    throw new Error(
      `Operation dependency cycle: ${[...path, name].join(" -> ")}`,
    );
  for (const next of graph.get(name) ?? []) visit(next, [...path, name]);
}
for (const name of graph.keys()) visit(name, []);
console.log(
  `Verified ${graph.size} packages: declared imports, private-schema boundaries and acyclic domain operations; lazy schema references may be cyclic`,
);
