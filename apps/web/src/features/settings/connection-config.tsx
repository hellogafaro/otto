import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Textarea } from "@workspace/ui/components/textarea";
import type { InferRequestType, InferResponseType } from "hono/client";
import { useId, useState } from "react";
import { read, type workspaceApi } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import {
  Choice,
  SettingsDialog,
  SettingsField,
  useSettingsAction,
} from "./controls";

type Connection = InferResponseType<
  typeof workspaceApi.connections.$get
>["items"][number];
type Config = NonNullable<
  InferRequestType<
    (typeof workspaceApi.connections)[":id"]["$patch"]
  >["json"]["config"]
>;
const lines = (value: string, limit: number) => {
  const items = value
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
  if (items.length > limit) throw new Error(`Use at most ${limit} entries.`);
  return items;
};
export function positiveId(value: string): number {
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) <= 0
  )
    throw new Error("Enter a positive numeric ID.");
  return Number(value);
}
export function safeEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid MCP endpoint URL.");
  }
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "[::1]"].includes(url.hostname)
      )) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use HTTPS or deployment-approved loopback HTTP, without credentials, query parameters or fragments.",
    );
  return url.href;
}
export function githubRepositories(
  value: string,
): Extract<Config, { type: "github" }>["repositories"] {
  const entries = lines(value, 50);
  if (!entries.length) throw new Error("Select at least one repository.");
  return entries.map((line) => {
    const parts = line.split(/\s+/);
    if (
      parts.length !== 2 ||
      !parts[0] ||
      !parts[1] ||
      !/^[\w.-]+\/[\w.-]+$/.test(parts[1]) ||
      parts[1].length > 200
    )
      throw new Error("Enter each repository as: numeric ID owner/repository.");
    return { id: positiveId(parts[0]), name: parts[1] };
  });
}
export function mcpTools(
  value: string,
): Extract<Config, { type: "mcp" }>["tools"] {
  return lines(value, 50).map((line) => {
    const [name, targetArgument, mode, ...extra] = line.split(/\s+/);
    if (
      extra.length ||
      !name ||
      !/^[\w.-]{1,100}$/.test(name) ||
      !targetArgument ||
      targetArgument.length > 200 ||
      (mode !== "read" && mode !== "write")
    )
      throw new Error(
        "Enter each tool as: toolName targetArgument read|write.",
      );
    return { name, targetArgument, readOnly: mode === "read" };
  });
}
function LinesField({
  label,
  description,
  value,
  onChange,
  maxLength,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldDescription>{description}</FieldDescription>
    </Field>
  );
}
export function ConnectionConfigDialog({
  connection,
  open,
  onOpenChange,
}: {
  connection: Connection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { api, workspaceId } = useWorkspace();
  const action = useSettingsAction();
  const [credentialRef, setCredentialRef] = useState("");
  const [appId, setAppId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [installationId, setInstallationId] = useState("");
  const [repositories, setRepositories] = useState("");
  const [issues, setIssues] = useState<"none" | "read" | "write">("none");
  const [endpoint, setEndpoint] = useState("");
  const [tools, setTools] = useState("");
  const [resources, setResources] = useState("");
  const [replaceConfig, setReplaceConfig] = useState<
    "binding" | "configuration"
  >("binding");
  return (
    <SettingsDialog
      title={`Configure ${connection.title}`}
      description="Saved configuration is private to the server and cannot be read here. A replacement disconnects the connection and revokes existing grants. Enter deployment-approved references only; never keys or tokens."
      open={open}
      onOpenChange={onOpenChange}
      pending={action.pending}
      error={action.error}
      submitLabel="Replace configuration"
      onSubmit={async () => {
        if (
          await action.perform(async () => {
            if (credentialRef && !/^[\w.:/-]{1,200}$/.test(credentialRef))
              throw new Error(
                "Enter the deployment-approved credential reference, not a credential value.",
              );
            if (replaceConfig === "binding" && !credentialRef)
              throw new Error("Enter a credential reference.");
            let config: Config | undefined;
            if (replaceConfig === "configuration") {
              config =
                connection.type === "github"
                  ? {
                      type: "github",
                      appId: appId.trim(),
                      accountId: positiveId(accountId),
                      installationId: positiveId(installationId),
                      repositories: githubRepositories(repositories),
                      permissions: issues === "none" ? {} : { issues },
                    }
                  : {
                      type: "mcp",
                      endpoint: safeEndpoint(endpoint),
                      tools: mcpTools(tools),
                      resources: lines(resources, 100),
                    };
            }
            await read(
              await api.connections[":id"].$patch({
                param: { workspaceId, id: connection.id },
                json: {
                  editToken: connection.editToken,
                  credentialRef: credentialRef || undefined,
                  config,
                },
              }),
            );
          }, "Connection configuration replaced")
        )
          onOpenChange(false);
      }}
    >
      <Field>
        <FieldLabel>Replace</FieldLabel>
        <Choice
          label="Configuration replacement"
          value={replaceConfig}
          options={{
            binding: "Credential reference",
            configuration: "Provider configuration",
          }}
          onChange={setReplaceConfig}
        />
      </Field>
      <SettingsField
        label="Credential reference"
        description="An approved server binding name. Blank preserves it when replacing provider configuration."
        value={credentialRef}
        required={replaceConfig === "binding"}
        maxLength={200}
        autoComplete="off"
        onChange={(event) => setCredentialRef(event.target.value.trim())}
      />
      {replaceConfig === "configuration" &&
        (connection.type === "github" ? (
          <>
            <SettingsField
              label="GitHub App ID"
              required
              value={appId}
              maxLength={200}
              onChange={(event) => setAppId(event.target.value)}
            />
            <SettingsField
              label="Account ID"
              required
              inputMode="numeric"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            />
            <SettingsField
              label="Installation ID"
              required
              inputMode="numeric"
              value={installationId}
              onChange={(event) => setInstallationId(event.target.value)}
            />
            <LinesField
              label="Repositories"
              description="One numeric repository ID and owner/repository per line; at most 50. Account and installation must match the saved association."
              value={repositories}
              onChange={setRepositories}
              maxLength={12000}
            />
            <Field>
              <FieldLabel>Issues permission</FieldLabel>
              <Choice
                label="Issues permission"
                value={issues}
                options={{ none: "None", read: "Read", write: "Write" }}
                onChange={setIssues}
              />
            </Field>
          </>
        ) : (
          <>
            <SettingsField
              label="MCP endpoint"
              type="url"
              required
              maxLength={2000}
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
            />
            <LinesField
              label="Trusted tools"
              description="One toolName targetArgument read|write per line; at most 50. Mark read only after verifying its behavior."
              value={tools}
              onChange={setTools}
              maxLength={17000}
            />
            <LinesField
              label="Resource URIs"
              description="One exact resource URI per line; at most 100."
              value={resources}
              onChange={setResources}
              maxLength={200000}
            />
          </>
        ))}
    </SettingsDialog>
  );
}
