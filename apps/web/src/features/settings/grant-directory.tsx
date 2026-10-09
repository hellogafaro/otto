import { useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { type ReactNode, useState } from "react";
import { QueryState } from "@/components/query-state";
import { read } from "@/lib/api";
import type { useDirectory } from "@/lib/directory";
import { useWorkspace } from "@/lib/workspace";
import { Choice, SettingsPaging } from "./controls";

type Agent = ReturnType<typeof useDirectory>["agents"][number];
type Member = ReturnType<typeof useDirectory>["members"][number];
export type GrantAgent = Pick<Agent, "id" | "title">;

/** Grant pickers page the authoritative directory instead of truncating the audience. */
export function GrantAgents({
  createdBy,
  enabled,
  render,
  includeArchived = false,
}: {
  createdBy?: string;
  enabled: boolean;
  render: (agent: Agent) => ReactNode;
  includeArchived?: boolean;
}) {
  const { api, workspaceId } = useWorkspace();
  const [query, setQuery] = useState("");
  const [after, setAfter] = useState<string>();
  const [archived, setArchived] = useState<"false" | "true">("false");
  const request = {
    createdBy,
    query: query || undefined,
    after,
    archived,
    sort: "title" as const,
    limit: "100",
  };
  const agents = useQuery({
    queryKey: ["workspace", workspaceId, "settings", "grant-agents", request],
    queryFn: async () =>
      read(await api.agents.$get({ param: { workspaceId }, query: request })),
    enabled,
  });
  return (
    <div className="flex flex-col gap-2">
      <Input
        aria-label="Search grant agents"
        placeholder="Search agent whole words"
        maxLength={200}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setAfter(undefined);
        }}
      />
      {includeArchived && (
        <Choice
          label="Agent archive filter"
          value={archived}
          options={{ false: "Current agents", true: "Archived agents" }}
          onChange={(archived) => {
            setArchived(archived);
            setAfter(undefined);
          }}
        />
      )}
      <QueryState
        pending={enabled && agents.isPending}
        error={agents.error}
        retry={agents.refetch}
      />
      {agents.data && !agents.error && (
        <>
          {agents.data.items.map((agent) => (
            <div key={agent.id}>{render(agent)}</div>
          ))}
          {!agents.data.items.length && <p>No agents match</p>}
          <SettingsPaging
            next={agents.data.next}
            after={after}
            change={setAfter}
          />
        </>
      )}
    </div>
  );
}
export function GrantMembers({
  enabled,
  render,
}: {
  enabled: boolean;
  render: (member: Member) => ReactNode;
}) {
  const { api, workspaceId } = useWorkspace();
  const [query, setQuery] = useState("");
  const [after, setAfter] = useState<string>();
  const request = {
    query: query || undefined,
    after,
    sort: "name" as const,
    limit: "100",
  };
  const members = useQuery({
    queryKey: ["workspace", workspaceId, "settings", "grant-members", request],
    queryFn: async () =>
      read(await api.members.$get({ param: { workspaceId }, query: request })),
    enabled,
  });
  return (
    <div className="flex flex-col gap-2">
      <Input
        aria-label="Search grant audience members"
        placeholder="Search member whole words"
        maxLength={200}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setAfter(undefined);
        }}
      />
      <QueryState
        pending={enabled && members.isPending}
        error={members.error}
        retry={members.refetch}
      />
      {members.data && !members.error && (
        <>
          {members.data.items.map((member) => (
            <div key={member.userId}>{render(member)}</div>
          ))}
          {!members.data.items.length && <p>No members match</p>}
          <SettingsPaging
            next={members.data.next}
            after={after}
            change={setAfter}
          />
        </>
      )}
    </div>
  );
}
export function GrantAgentButton({
  agent,
  selected,
  onSelect,
}: {
  agent: GrantAgent;
  selected: GrantAgent | null;
  onSelect: (agent: GrantAgent) => void;
}) {
  return (
    <Button
      type="button"
      variant={selected?.id === agent.id ? "secondary" : "ghost"}
      size="compact"
      aria-pressed={selected?.id === agent.id}
      onClick={() => onSelect({ id: agent.id, title: agent.title })}
    >
      {agent.title} ({agent.id})
    </Button>
  );
}
