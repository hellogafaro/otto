import ts from "typescript";

const retired = new Set([
  "saveDocument",
  "createdById",
  "revokeInvitation",
  "saveAutomation",
  "saveSessionContext",
  "removeParticipant",
  "removeMember",
  "grantConnection",
  "startJobs",
  "JOBS_SCHEMA",
  "lastRevision",
  "advanceRevision",
  "getRevision",
  "kind",
  "configToken",
  "agentConfigToken",
  "automationToken",
  "accountConnectionId",
  "harnessRelease",
  "Harnesses",
  "connectAcp",
  "AcpHandlers",
  "harnesses",
  "artifactKind",
  "memberPageQuery",
  "transferTask",
  "setCollectionView",
  "setProjectSkills",
  "createContentApi",
  "createConnectionApi",
  "transferAutomation",
  "archiveAutomation",
  "deliverOccurrence",
]);
const routes = new Map<string, string>();
let files = 0;
let catches = 0;
for (const root of ["packages", "apps/server/src"]) {
  for await (const path of new Bun.Glob("**/*.ts").scan(root)) {
    if (path.startsWith("ui/") || path.includes("node_modules/")) continue;
    const file = `${root}/${path}`;
    const source = await Bun.file(file).text();
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    files++;
    const visit = (node: ts.Node) => {
      if (
        ts.isIdentifier(node) &&
        (retired.has(node.text) || /^getMany[A-Z]/.test(node.text))
      )
        throw new Error(`Retired handwritten name ${node.text}: ${file}`);
      if (
        file.endsWith("/schema.ts") &&
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "access"
      )
        throw new Error(
          `Use domain visibility, not the retired access field: ${file}`,
        );
      if (
        file.startsWith("packages/conversations/") &&
        ts.isStringLiteral(node) &&
        ["inherited", "restricted"].includes(node.text)
      )
        throw new Error(`Retired Conversation visibility value: ${file}`);
      if (
        file.startsWith("packages/shared/") &&
        (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node))
      )
        throw new Error(
          `Shared primitives must remain dependency-free: ${file}`,
        );
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "pgTable"
      ) {
        const tableName = node.arguments[0];
        const columns = node.arguments[1];
        if (
          tableName &&
          ts.isStringLiteral(tableName) &&
          tableName.text !== "auth_users" &&
          columns &&
          ts.isObjectLiteralExpression(columns) &&
          columns.properties.some(
            (column) =>
              ts.isPropertyAssignment(column) &&
              ts.isIdentifier(column.name) &&
              column.name.text === "name",
          )
        )
          throw new Error(`Owned display labels use title, not name: ${file}`);
        if (
          tableName &&
          ts.isStringLiteral(tableName) &&
          tableName.text === "documents" &&
          columns &&
          ts.isObjectLiteralExpression(columns) &&
          columns.properties.some(
            (column) =>
              ts.isPropertyAssignment(column) &&
              ts.isIdentifier(column.name) &&
              [
                "skill",
                "skillMetadata",
                "whenToUse",
                "supportingFiles",
              ].includes(column.name.text),
          )
        )
          throw new Error(
            `Skills own their fields; Documents are ordinary content: ${file}`,
          );
        if (
          tableName &&
          ts.isStringLiteral(tableName) &&
          tableName.text === "agent_skills"
        )
          throw new Error(
            `Pure junction tables use plural entities: agents_skills: ${file}`,
          );
        const name = node.arguments[0];
        if (
          !name ||
          !ts.isStringLiteral(name) ||
          (name.text !== "automation_history" &&
            !/^[a-z]+(?:_[a-z]+)*s$/.test(name.text))
        )
          throw new Error(`Otto tables must use plural snake_case: ${file}`);
      }
      if (
        ts.isInterfaceDeclaration(node) &&
        node.name.text === "CollectionField" &&
        node.members.some(
          (member) =>
            ts.isPropertySignature(member) &&
            member.name &&
            ts.isIdentifier(member.name) &&
            member.name.text === "name",
        )
      )
        throw new Error(`Collection field labels use title: ${file}`);
      if (ts.isCatchClause(node)) catches++;
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        if (node.expression.name.text === "catch") catches++;
        const method = node.expression.name.text;
        const argument = node.arguments[0];
        if (
          file.startsWith("apps/server/src/") &&
          ["get", "post", "put", "patch", "delete"].includes(method) &&
          argument &&
          ts.isStringLiteral(argument) &&
          argument.text.startsWith("/")
        ) {
          const key = `${method} ${argument.text.replace(/:[^/]+/g, ":id")}`;
          const earlier = routes.get(key);
          if (earlier)
            throw new Error(`Duplicate transport ${key}: ${earlier}, ${file}`);
          routes.set(key, file);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
}
console.log(
  `Verified ${files} backend files: current names, dependency-free shared primitives, ${routes.size} unique transport paths. ${catches} catch/rejection sites require semantic review.`,
);
