import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
} from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Field, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { toast } from "@workspace/ui/components/sonner";
import { Textarea } from "@workspace/ui/components/textarea";
import { useEffect, useState } from "react";
import { ConfigurationChoice } from "@/components/agents-configuration-choice";
import { isDeniedDomainRead } from "@/components/agents-schedules-mutation-safety";
import { useConfirm } from "@/components/confirm";
import { useAskAgent } from "@/components/floating-chat";
import { QueryState } from "@/components/query-state";
import { Group, Row } from "@/features/settings/controls";
import { read } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

export function SkillsSettings() {
  const { api, workspaceId, workspace } = useWorkspace();
  const ask = useAskAgent();
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>();
  const list = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "skills", { archived, query }],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.skills.$get({
          param: { workspaceId },
          query: {
            archived: archived ? "true" : "false",
            query: query || undefined,
            limit: "100",
            sort: "title",
            after: pageParam,
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const items = isDeniedDomainRead(list.error)
    ? []
    : (list.data?.pages.flatMap((page) => page.items) ?? []);
  const empty = Boolean(
    list.data &&
      !list.error &&
      !items.length &&
      !query &&
      !archived &&
      !selected,
  );
  const retained = useQuery({
    queryKey: ["workspace", workspaceId, "skills", "archived-existence"],
    enabled: empty,
    queryFn: async () =>
      read(
        await api.skills.$get({
          param: { workspaceId },
          query: { archived: "true", limit: "1", sort: "title" },
        }),
      ),
  });
  if (empty && (retained.isPending || retained.error))
    return (
      <QueryState
        pending={retained.isPending}
        error={retained.error}
        retry={retained.refetch}
      />
    );
  if (empty)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            {retained.data?.items.length ? "No active skills" : "No skills"}
          </EmptyTitle>
          <EmptyDescription>
            {retained.data?.items.length
              ? "Retained archived Skills can be opened and restored from the Archived view."
              : "Skills created through the composer show up here."}
          </EmptyDescription>
        </EmptyHeader>
        {retained.data?.items.length ? (
          <EmptyContent>
            <ConfigurationChoice
              label="Skill state"
              value={archived ? "archived" : "active"}
              options={{ active: "Active", archived: "Archived" }}
              onChange={(value) => setArchived(value === "archived")}
            />
          </EmptyContent>
        ) : (
          workspace.role !== "viewer" && (
            <EmptyContent>
              <Button
                onClick={() =>
                  ask(
                    "Create a reusable Skill. Ask for its title, instructions and when to use it, then request exact human approval.",
                  )
                }
              >
                Ask agent
              </Button>
            </EmptyContent>
          )
        )}
      </Empty>
    );
  return (
    <>
      <Group description="Reusable instructions and supporting files. Create and update Skills through the composer.">
        <Row title="Find skills">
          <Input
            aria-label="Search skills by whole words"
            placeholder="Search by whole words"
            maxLength={200}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Row>
        <Row title="State">
          <ConfigurationChoice
            label="Skill state"
            value={archived ? "archived" : "active"}
            options={{ active: "Active", archived: "Archived" }}
            onChange={(value) => setArchived(value === "archived")}
          />
        </Row>
        {workspace.role !== "viewer" && (
          <Row title="Create or update">
            <Button
              variant="outline"
              size="compact"
              onClick={() =>
                ask(
                  "Create a reusable Skill. Ask me for its title, instructions, when to use it and supporting saved Files. Request exact human approval before saving.",
                )
              }
            >
              Ask agent
            </Button>
          </Row>
        )}
        <QueryState
          pending={list.isPending}
          error={list.error}
          retry={list.refetch}
        />
        {!list.error &&
          items.map((skill) => (
            <Row
              key={skill.id}
              title={skill.title}
              description={skill.archived ? "Archived" : "Active"}
            >
              <Button
                variant="ghost"
                size="compact"
                onClick={() => setSelected(skill.id)}
              >
                Open skill
              </Button>
            </Row>
          ))}
        {!list.isPending && !list.error && !items.length && (
          <Row
            title="No skills"
            description="Skills created through the composer show up here."
          />
        )}
        {list.hasNextPage && (
          <Button
            variant="ghost"
            disabled={list.isFetchingNextPage}
            onClick={() => list.fetchNextPage()}
          >
            More skills
          </Button>
        )}
        <QueryState
          error={list.isFetchNextPageError ? list.error : null}
          retry={list.fetchNextPage}
        />
      </Group>
      <SkillDialog id={selected} close={() => setSelected(undefined)} />
    </>
  );
}

export function AgentSkills({ selected }: { selected: string[] }) {
  const { api, workspaceId } = useWorkspace();
  const [open, setOpen] = useState<string>();
  const skills = useQueries({
    queries: selected.map((id) => ({
      queryKey: ["workspace", workspaceId, "skill", id],
      queryFn: async () =>
        read(await api.skills[":id"].$get({ param: { workspaceId, id } })),
      retry: false,
    })),
  });
  return (
    <>
      <Group
        title="Selected skills"
        description="This Agent's saved selection. Change the complete selection through the composer."
      >
        {selected.map((id, index) => {
          const skill = skills[index];
          const current = skill && !skill.error ? skill.data : undefined;
          return (
            <Row
              key={id}
              title={
                current?.title ??
                (skill?.isPending ? "Loading skill" : "Unavailable skill")
              }
              description={current?.archived ? "Archived" : undefined}
            >
              {current && (
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={() => setOpen(id)}
                >
                  Open skill
                </Button>
              )}
            </Row>
          );
        })}
        {!selected.length && (
          <Row
            title="No skills"
            description="Skills assigned through the composer show up here."
          />
        )}
      </Group>
      <SkillDialog id={open} close={() => setOpen(undefined)} />
    </>
  );
}

function SkillDialog({ id, close }: { id?: string; close: () => void }) {
  return (
    <Dialog
      open={!!id}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Skill</DialogTitle>
        </DialogHeader>
        {id && <SkillDetail id={id} close={close} />}
      </DialogContent>
    </Dialog>
  );
}

function SkillDetail({ id, close }: { id: string; close: () => void }) {
  const { api, workspaceId, workspace, user, invalidate } = useWorkspace();
  const ask = useAskAgent();
  const confirm = useConfirm();
  const [readDenied, setReadDenied] = useState<Error>();
  const query = useQuery({
    queryKey: ["workspace", workspaceId, "skill", id],
    queryFn: async () =>
      read(await api.skills[":id"].$get({ param: { workspaceId, id } })),
  });
  const skill = !query.error ? query.data : undefined;
  const canManage = skill?.createdBy === user.id && workspace.role !== "viewer";
  const exported = useMutation({
    mutationFn: async () =>
      read(await api.skills[":id"].export.$get({ param: { workspaceId, id } })),
    retry: false,
  });
  const archive = useMutation({
    mutationFn: async () => {
      if (!skill) throw new Error("Skill unavailable.");
      return read(
        await api.skills[":id"].archive.$post({
          param: { workspaceId, id },
          json: { editToken: skill.editToken, archived: !skill.archived },
        }),
      );
    },
    onSuccess: async () => {
      await invalidate();
      await query.refetch();
      toast.success(skill?.archived ? "Skill restored" : "Skill archived");
    },
    retry: false,
  });
  const proposals = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "skill-proposals", id],
    initialPageParam: undefined as string | undefined,
    enabled: !!skill,
    queryFn: async ({ pageParam }) =>
      read(
        await api.skills[":id"].proposals.$get({
          param: { workspaceId, id },
          query: { limit: "100", after: pageParam },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const resolve = useMutation({
    mutationFn: async ({
      proposalId,
      accept,
    }: {
      proposalId: string;
      accept: boolean;
    }) =>
      read(
        await api.skills[":id"].proposals[":proposalId"].resolve.$post({
          param: { workspaceId, id, proposalId },
          json: { accept },
        }),
      ),
    onSuccess: async () => {
      await invalidate();
      await query.refetch();
      await proposals.refetch();
      toast.success("Proposal resolved");
    },
    retry: false,
  });
  const denied = [query.error, proposals.error, exported.error].find(
    isDeniedDomainRead,
  );
  useEffect(() => {
    if (denied) setReadDenied(denied);
  }, [denied]);
  if (denied || readDenied)
    return (
      <>
        <QueryState
          error={denied ?? readDenied}
          retry={async () => {
            const [metadata, proposed] = await Promise.all([
              query.refetch(),
              proposals.refetch(),
            ]);
            if (metadata.error || proposed.error) return;
            if (exported.error || exported.data) {
              try {
                await exported.mutateAsync();
              } catch {
                return;
              }
            }
            setReadDenied(undefined);
          }}
        />
        <Button variant="ghost" className="self-end" onClick={close}>
          Close
        </Button>
      </>
    );
  return (
    <>
      <QueryState
        pending={query.isPending}
        error={query.error}
        retry={query.refetch}
      />
      {skill && (
        <>
          <Group title={skill.title}>
            <Row
              title="State"
              description={skill.archived ? "Archived" : "Active"}
            />
            <Row
              title="Visibility"
              description={
                skill.visibility === "user" ? "Only creator" : "Workspace"
              }
            />
            <Row title="Instructions">
              <pre className="max-w-full whitespace-pre-wrap break-words">
                {skill.instructions}
              </pre>
            </Row>
            <Row
              title="When to use"
              description={skill.whenToUse || "Not specified"}
            />
            <Row title="Read-only export">
              <Button
                variant="outline"
                size="compact"
                disabled={exported.isPending}
                onClick={() => exported.mutate()}
              >
                Export SKILL.md
              </Button>
            </Row>
            {exported.data && !exported.error && (
              <Field>
                <FieldLabel htmlFor="export-skill">
                  Exported SKILL.md
                </FieldLabel>
                <Textarea
                  id="export-skill"
                  readOnly
                  value={exported.data.skillMd}
                  className="min-h-40"
                />
              </Field>
            )}
            {canManage && (
              <Row title="Manage through composer">
                <Button
                  variant="outline"
                  size="compact"
                  onClick={() => {
                    close();
                    ask(
                      `Update this Skill through an exact human-approved request. Current authorized target: ${JSON.stringify({ skillId: skill.id, editToken: skill.editToken, title: skill.title, supportingFiles: skill.supportingFiles.map(({ path, fileId }) => ({ path, fileId })) })}. Ask what I want to change. Preserve unrequested fields; do not silently replace a stale token.`,
                    );
                  }}
                >
                  Ask agent
                </Button>
              </Row>
            )}
            {canManage && (
              <Row title="Availability">
                <Button
                  variant="outline"
                  size="compact"
                  disabled={archive.isPending}
                  onClick={async () => {
                    const action = skill.archived
                      ? "Restore skill"
                      : "Archive skill";
                    if (
                      await confirm({
                        title: `${action}: ${skill.title}?`,
                        description: skill.archived
                          ? "Make this Skill available for new selections again."
                          : "Block new Run admission using this Skill. Saved content is retained; active Runs are not automatically stopped.",
                        action,
                        destructive: !skill.archived,
                      })
                    )
                      archive.mutate();
                  }}
                >
                  {skill.archived ? "Restore skill" : "Archive skill"}
                </Button>
              </Row>
            )}
          </Group>
          <Group title="Supporting files">
            {skill.supportingFiles.map((file) => (
              <Row
                key={`${file.path}:${file.fileId}`}
                title={file.path}
                description={`${file.byteLength} bytes`}
              >
                <Button
                  variant="ghost"
                  size="compact"
                  nativeButton={false}
                  render={
                    <a
                      href={`/library?open=${file.fileId}${skill.projectId ? `&project=${skill.projectId}` : ""}`}
                    />
                  }
                >
                  Open File
                </Button>
              </Row>
            ))}
            {!skill.supportingFiles.length && (
              <Row
                title="No files"
                description="Saved supporting Files selected through the composer show up here."
              />
            )}
          </Group>
          <Group
            title="Proposals"
            description="Review exact proposed content before approving it."
          >
            <QueryState
              pending={proposals.isPending}
              error={proposals.error}
              retry={proposals.refetch}
            />
            {!proposals.error &&
              proposals.data?.pages
                .flatMap((page) => page.items)
                .map((item) => (
                  <Row
                    key={item.id}
                    title={item.title}
                    description={item.instructions}
                  >
                    {canManage && (
                      <>
                        {([true, false] as const).map((accept) => (
                          <Button
                            key={String(accept)}
                            variant="outline"
                            size="compact"
                            disabled={resolve.isPending}
                            onClick={async () => {
                              const action = accept ? "Accept" : "Reject";
                              if (
                                await confirm({
                                  title: `${action} this proposal?`,
                                  description: `Review the exact title and instructions for ${item.title} before ${accept ? "accepting" : "rejecting"}.`,
                                  action,
                                })
                              )
                                resolve.mutate({ proposalId: item.id, accept });
                            }}
                          >
                            {accept ? "Accept" : "Reject"}
                          </Button>
                        ))}
                      </>
                    )}
                  </Row>
                ))}
            {proposals.data?.pages.every((page) => !page.items.length) && (
              <Row
                title="No proposals"
                description="Changes proposed to this Skill show up here."
              />
            )}
            {proposals.hasNextPage && (
              <Button
                variant="ghost"
                disabled={proposals.isFetchingNextPage}
                onClick={() => proposals.fetchNextPage()}
              >
                More proposals
              </Button>
            )}
          </Group>
        </>
      )}
      <QueryState error={archive.error ?? resolve.error ?? exported.error} />
      <Button variant="ghost" className="self-end" onClick={close}>
        Close
      </Button>
    </>
  );
}
