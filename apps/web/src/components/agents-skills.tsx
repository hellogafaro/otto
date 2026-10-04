import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { toast } from "@workspace/ui/components/sonner";
import { Textarea } from "@workspace/ui/components/textarea";
import type { InferResponseType } from "hono/client";
import { useEffect, useRef, useState } from "react";
import { ConfigurationChoice } from "@/components/agents-configuration-choice";
import {
  hasUncertainMutationOutcome,
  isDeniedDomainRead,
} from "@/components/agents-schedules-mutation-safety";
import { QueryState } from "@/components/query-state";
import { read, type workspaceApi } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import { Group, Row } from "@/routes/settings";

type Skill = InferResponseType<(typeof workspaceApi.skills)[":id"]["$get"]>;

export function AgentSkills({
  selected,
  projectId,
  canManage,
}: {
  selected: string[];
  projectId: string | null;
  canManage: boolean;
}) {
  const { api, workspaceId } = useWorkspace();
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
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
  if (isDeniedDomainRead(list.error))
    return (
      <Group title="Skills">
        <QueryState error={list.error} retry={list.refetch} />
      </Group>
    );
  return (
    <Group
      title="Skills"
      description={`${selected.length} selected. Skills own reusable instructions and supporting files.`}
    >
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
        {canManage && (
          <Button
            variant="outline"
            size="compact"
            onClick={() => setCreating(true)}
          >
            New skill
          </Button>
        )}
      </Row>
      <QueryState
        pending={list.isPending}
        error={list.error}
        retry={list.refetch}
      />
      {items.map((skill) => (
        <Row
          key={skill.id}
          title={skill.title}
          description={
            selected.includes(skill.id) ? "Selected by this agent" : undefined
          }
        >
          <Button
            variant="ghost"
            size="compact"
            onClick={() => setEditing(skill.id)}
          >
            {skill.archived ? "View archived skill" : "Open skill"}
          </Button>
        </Row>
      ))}
      {list.data && items.length === 0 && <Row title="No matching skills" />}
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
      <Dialog
        open={creating}
        onOpenChange={(open, details) => {
          if (!open && pending) details.cancel();
          else setCreating(open);
        }}
      >
        <DialogContent className="max-h-[85svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New skill</DialogTitle>
          </DialogHeader>
          {creating && (
            <CreateSkill
              onPendingChange={setPending}
              projectId={projectId}
              done={(id) => {
                setCreating(false);
                setEditing(id);
              }}
              cancel={() => setCreating(false)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!editing}
        onOpenChange={(open, details) => {
          if (!open && pending) details.cancel();
          else if (!open) setEditing(undefined);
        }}
      >
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Skill</DialogTitle>
          </DialogHeader>
          {editing && (
            <SkillDetail
              onPendingChange={setPending}
              id={editing}
              canManage={canManage}
              close={() => setEditing(undefined)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Group>
  );
}

function CreateSkill({
  projectId,
  done,
  cancel,
  onPendingChange,
}: {
  projectId: string | null;
  done: (id: string) => void;
  cancel: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const submitting = useRef(false);
  const [createUncertain, setCreateUncertain] = useState(false);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [whenToUse, setWhenToUse] = useState("");
  const [visibility, setVisibility] = useState<"user" | "workspace">("user");
  const [importing, setImporting] = useState(false);
  const [skillMd, setSkillMd] = useState("");
  const mutation = useMutation({
    mutationFn: async () =>
      importing
        ? read(
            await api.skills.import.$post({
              param: { workspaceId },
              json: { skillMd, visibility, projectId: projectId ?? undefined },
            }),
          )
        : read(
            await api.skills.$post({
              param: { workspaceId },
              json: {
                title,
                instructions,
                whenToUse,
                visibility,
                projectId: projectId ?? undefined,
              },
            }),
          ),
    onError: (error) => {
      if (hasUncertainMutationOutcome(error)) {
        setCreateUncertain(true);
        void invalidate();
      }
    },
    onSettled: () => {
      submitting.current = false;
    },
    onSuccess: async (skill) => {
      await invalidate();
      toast.success("Skill created");
      done(skill.id);
    },
  });
  useEffect(
    () => onPendingChange(mutation.isPending),
    [mutation.isPending, onPendingChange],
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (submitting.current || createUncertain) return;
        submitting.current = true;
        onPendingChange(true);
        mutation.mutate();
      }}
    >
      <fieldset disabled={mutation.isPending}>
        <FieldGroup>
          <Field>
            <FieldLabel>Source</FieldLabel>
            <ConfigurationChoice
              label="Skill source"
              value={importing ? "import" : "new"}
              options={{ new: "New instructions", import: "Import SKILL.md" }}
              onChange={(value) => setImporting(value === "import")}
            />
          </Field>
          {importing ? (
            <Field>
              <FieldLabel htmlFor="skill-import">SKILL.md</FieldLabel>
              <Textarea
                id="skill-import"
                required
                maxLength={100000}
                value={skillMd}
                onChange={(event) => setSkillMd(event.target.value)}
              />
            </Field>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="skill-title">Title</FieldLabel>
                <Input
                  id="skill-title"
                  required
                  maxLength={200}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="skill-instructions">
                  Instructions
                </FieldLabel>
                <Textarea
                  id="skill-instructions"
                  maxLength={100000}
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="skill-when">When to use</FieldLabel>
                <Textarea
                  id="skill-when"
                  maxLength={100000}
                  value={whenToUse}
                  onChange={(event) => setWhenToUse(event.target.value)}
                />
              </Field>
            </>
          )}
          <Field>
            <FieldLabel>Who can use it</FieldLabel>
            <ConfigurationChoice
              label="Skill visibility"
              value={visibility}
              options={{ user: "Only you", workspace: "Workspace" }}
              onChange={setVisibility}
            />
          </Field>
          {createUncertain && (
            <p role="alert">
              Otto may have created this Skill. Close and check the Skills list
              before creating again.
            </p>
          )}
          <QueryState error={mutation.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={createUncertain}>
              {mutation.isPending
                ? "Creating"
                : importing
                  ? "Import skill"
                  : "Create skill"}
            </Button>
          </div>
        </FieldGroup>
      </fieldset>
    </form>
  );
}

function SkillDetail({
  id,
  canManage,
  close,
  onPendingChange,
}: {
  id: string;
  canManage: boolean;
  close: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { api, workspaceId } = useWorkspace();
  const query = useQuery({
    queryKey: ["workspace", workspaceId, "skill", id],
    queryFn: async () =>
      read(await api.skills[":id"].$get({ param: { workspaceId, id } })),
  });
  if (isDeniedDomainRead(query.error) || !query.data)
    return (
      <QueryState
        pending={query.isPending}
        error={query.error}
        retry={query.refetch}
      />
    );
  return (
    <>
      <QueryState error={query.error} retry={query.refetch} />
      <SkillEditor
        onPendingChange={onPendingChange}
        key={id}
        initial={query.data}
        canManage={canManage}
        close={close}
      />
    </>
  );
}

function SkillEditor({
  initial,
  canManage,
  close,
  onPendingChange,
}: {
  initial: Skill;
  canManage: boolean;
  close: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { api, workspaceId, user, invalidate } = useWorkspace();
  const [skill, setSkill] = useState(initial);
  const [title, setTitle] = useState(skill.title);
  const [instructions, setInstructions] = useState(skill.instructions);
  const [whenToUse, setWhenToUse] = useState(skill.whenToUse ?? "");
  const [visibility, setVisibility] = useState(skill.visibility);
  const [files, setFiles] = useState(
    skill.supportingFiles.map(({ path, fileId, byteLength }) => ({
      path,
      fileId,
      byteLength,
    })),
  );
  const [fileId, setFileId] = useState("");
  const [path, setPath] = useState("");
  const [fileSearch, setFileSearch] = useState("");
  const [exported, setExported] = useState<string>();
  const [proposal, setProposal] = useState(false);
  const canEdit = canManage && skill.createdBy === user.id;
  const selectedFile = useQuery({
    queryKey: ["workspace", workspaceId, "file", fileId],
    enabled: canEdit && !!fileId,
    queryFn: async () =>
      read(await api.files[":id"].$get({ param: { workspaceId, id: fileId } })),
  });
  const sources = useInfiniteQuery({
    queryKey: [
      "workspace",
      workspaceId,
      "skill-file-sources",
      skill.projectId,
      fileSearch,
    ],
    enabled: canEdit,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.files.$get({
          param: { workspaceId },
          query: {
            projectId: skill.projectId ?? undefined,
            archived: "false",
            query: fileSearch || undefined,
            limit: "100",
            sort: "title",
            after: pageParam,
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const proposals = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "skill-proposals", skill.id],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.skills[":id"].proposals.$get({
          param: { workspaceId, id: skill.id },
          query: { limit: "100", after: pageParam },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const mutation = useMutation({
    mutationFn: async (action: "content" | "files" | "archive" | "propose") => {
      const param = { workspaceId, id: skill.id };
      if (action === "files")
        return read(
          await api.skills[":id"].files.$put({
            param,
            json: {
              editToken: skill.editToken,
              files: files.map(({ path, fileId }) => ({ path, fileId })),
            },
          }),
        );
      if (action === "archive")
        return read(
          await api.skills[":id"].archive.$post({
            param,
            json: { editToken: skill.editToken, archived: !skill.archived },
          }),
        );
      if (action === "propose") {
        await read(
          await api.skills[":id"].proposals.$post({
            param,
            json: { title, instructions, editToken: skill.editToken },
          }),
        );
        return undefined;
      }
      return read(
        await api.skills[":id"].$patch({
          param,
          json: {
            title,
            instructions,
            whenToUse,
            visibility,
            editToken: skill.editToken,
          },
        }),
      );
    },
    onSuccess: async (result, action) => {
      if (result) setSkill(result);
      if (action === "propose") {
        setTitle(skill.title);
        setInstructions(skill.instructions);
      }
      await invalidate();
      toast.success(
        action === "archive"
          ? skill.archived
            ? "Skill restored"
            : "Skill archived"
          : action === "propose"
            ? "Proposal submitted"
            : "Skill saved",
      );
      setProposal(false);
    },
  });
  const exportMutation = useMutation({
    mutationFn: async () =>
      read(
        await api.skills[":id"].export.$get({
          param: { workspaceId, id: skill.id },
        }),
      ),
    onSuccess: (result) => setExported(result.skillMd),
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
          param: { workspaceId, id: skill.id, proposalId },
          json: { accept },
        }),
      ),
    onSuccess: async () => {
      await invalidate();
      const result = await read(
        await api.skills[":id"].$get({ param: { workspaceId, id: skill.id } }),
      );
      setSkill(result);
      setTitle(result.title);
      setInstructions(result.instructions);
      setWhenToUse(result.whenToUse ?? "");
      setVisibility(result.visibility);
      toast.success("Proposal resolved");
    },
  });
  const busy = mutation.isPending || resolve.isPending;
  useEffect(() => onPendingChange(busy), [busy, onPendingChange]);
  const writable = canEdit || proposal;
  return (
    <div className="flex flex-col gap-5">
      <fieldset disabled={busy} className="flex min-w-0 flex-col gap-5">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="edit-skill-title">Title</FieldLabel>
            <Input
              id="edit-skill-title"
              maxLength={200}
              disabled={!writable}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-skill-instructions">
              Instructions
            </FieldLabel>
            <Textarea
              id="edit-skill-instructions"
              disabled={!writable}
              maxLength={100000}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              className="min-h-40"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-skill-when">When to use</FieldLabel>
            <Textarea
              id="edit-skill-when"
              disabled={!canEdit}
              maxLength={100000}
              value={whenToUse}
              onChange={(event) => setWhenToUse(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>Who can use it</FieldLabel>
            <ConfigurationChoice
              label="Skill visibility"
              value={visibility}
              options={{ user: "Only you", workspace: "Workspace" }}
              disabled={!canEdit}
              onChange={setVisibility}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <>
                <Button
                  disabled={!title.trim()}
                  onClick={() => mutation.mutate("content")}
                >
                  Save instructions
                </Button>
                <Button
                  variant="outline"
                  onClick={() => mutation.mutate("archive")}
                >
                  {skill.archived ? "Restore skill" : "Archive skill"}
                </Button>
              </>
            )}
            {!canEdit && canManage && (
              <Button
                disabled={proposal && !title.trim()}
                variant="outline"
                onClick={() =>
                  proposal ? mutation.mutate("propose") : setProposal(true)
                }
              >
                {proposal ? "Submit proposal" : "Propose changes"}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={exportMutation.isPending}
              onClick={() => exportMutation.mutate()}
            >
              Export SKILL.md
            </Button>
          </div>
        </FieldGroup>
        <Group
          title="Supporting files"
          description="Saved Files in the same Project only, up to 8 MiB in total. Paths must be under scripts/, references/ or assets/. The server checks the current audience."
        >
          {files.map((file, index) => (
            <Row key={`${file.path}:${file.fileId}`} title={file.path}>
              <span>{file.byteLength} bytes</span>
              <Button
                variant="ghost"
                size="compact"
                nativeButton={false}
                render={
                  <a
                    href={`/files?open=${file.fileId}${skill.projectId ? `&project=${skill.projectId}` : ""}`}
                  />
                }
              >
                Open File
              </Button>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={() =>
                    setFiles((current) => current.filter((_, i) => i !== index))
                  }
                >
                  Remove
                </Button>
              )}
            </Row>
          ))}
          {!files.length && <Row title="No supporting files" />}
          {canEdit && (
            <>
              <Row title="Find saved Files">
                <Input
                  aria-label="Search supporting files by whole words"
                  value={fileSearch}
                  maxLength={200}
                  onChange={(event) => {
                    setFileSearch(event.target.value);
                    setFileId("");
                  }}
                />
              </Row>
              <QueryState
                pending={sources.isPending}
                error={sources.error}
                retry={sources.refetch}
              />
              <Row title="File">
                <ConfigurationChoice
                  label="Supporting File"
                  value={fileId}
                  options={{
                    "": "Choose a saved File",
                    ...Object.fromEntries(
                      (!isDeniedDomainRead(sources.error)
                        ? sources.data
                        : undefined
                      )?.pages
                        .flatMap((page) => page.items)
                        .filter(
                          (file) =>
                            file.projectId === skill.projectId &&
                            file.byteLength <= 8 * 1024 * 1024,
                        )
                        .map((file) => [file.id, file.title]) ?? [],
                    ),
                  }}
                  onChange={setFileId}
                />
              </Row>
              <QueryState
                pending={!!fileId && selectedFile.isPending}
                error={selectedFile.error}
                retry={selectedFile.refetch}
              />
              {selectedFile.data?.sourceRunId && (
                <p>
                  Run-output Files cannot support a Skill. Choose a saved upload
                  in the same Project.
                </p>
              )}
              {sources.hasNextPage && (
                <Button
                  variant="ghost"
                  disabled={sources.isFetchingNextPage}
                  onClick={() => sources.fetchNextPage()}
                >
                  More Files
                </Button>
              )}
              <Row title="Relative path">
                <Input
                  aria-label="Supporting file path"
                  placeholder="references/example.md"
                  maxLength={240}
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                />
                <Button
                  variant="outline"
                  size="compact"
                  disabled={
                    !fileId ||
                    !selectedFile.data ||
                    isDeniedDomainRead(selectedFile.error) ||
                    selectedFile.data.sourceRunId !== null ||
                    files.reduce((total, file) => total + file.byteLength, 0) +
                      selectedFile.data.byteLength >
                      8 * 1024 * 1024 ||
                    !path.trim() ||
                    files.length >= 30 ||
                    files.some((file) => file.path === path.trim())
                  }
                  onClick={() => {
                    setFiles((current) => [
                      ...current,
                      {
                        path: path.trim(),
                        fileId,
                        byteLength: selectedFile.data?.byteLength ?? 0,
                      },
                    ]);
                    setFileId("");
                    setPath("");
                  }}
                >
                  Add
                </Button>
              </Row>
              <Row title="Save file selection">
                <Button
                  variant="outline"
                  size="compact"
                  onClick={() => mutation.mutate("files")}
                >
                  Save supporting files
                </Button>
              </Row>
            </>
          )}
        </Group>
        <Group title="Proposals">
          <QueryState
            pending={proposals.isPending}
            error={proposals.error}
            retry={proposals.refetch}
          />
          {(!isDeniedDomainRead(proposals.error)
            ? proposals.data
            : undefined
          )?.pages
            .flatMap((page) => page.items)
            .map((item) => (
              <Row
                key={item.id}
                title={item.title}
                description={item.instructions}
              >
                {canEdit && (
                  <>
                    <Button
                      variant="outline"
                      size="compact"
                      onClick={() =>
                        resolve.mutate({ proposalId: item.id, accept: true })
                      }
                    >
                      Accept
                    </Button>
                    <Button
                      variant="ghost"
                      size="compact"
                      onClick={() =>
                        resolve.mutate({ proposalId: item.id, accept: false })
                      }
                    >
                      Reject
                    </Button>
                  </>
                )}
              </Row>
            ))}
          {proposals.data?.pages.every((page) => page.items.length === 0) && (
            <Row title="No proposals" />
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
      </fieldset>
      <QueryState
        error={mutation.error ?? resolve.error ?? exportMutation.error}
      />
      {mutation.error && (
        <p>
          Close and reopen this skill to reload the latest edit token before
          retrying a conflict.
        </p>
      )}
      {exported && (
        <Field>
          <FieldLabel htmlFor="export-skill">Exported SKILL.md</FieldLabel>
          <Textarea
            id="export-skill"
            readOnly
            value={exported}
            className="min-h-40"
          />
        </Field>
      )}
      <Button
        variant="ghost"
        className="self-end"
        disabled={busy}
        onClick={close}
      >
        Close
      </Button>
    </div>
  );
}
