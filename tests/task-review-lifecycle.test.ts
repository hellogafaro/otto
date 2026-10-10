import { createCursorCodec } from "@otto/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { archiveAgent, createAgent } from "../packages/agents/src";
import { createChat, createParticipant } from "../packages/chats/src";
import { createProject, upsertProjectMember } from "../packages/projects/src";
import { projectMembers } from "../packages/projects/src/schema";
import { nativeActionInput } from "../packages/runs/src/action-schema";
import {
  archiveTask,
  createTask,
  getTask,
  getTasks,
  setTaskStatus,
} from "../packages/tasks/src";
import {
  createTaskComment,
  deleteTaskComment,
  getTaskComments,
  getTaskNotifications,
  updateTaskComment,
} from "../packages/tasks/src/comments";
import {
  taskComments,
  taskReviews,
} from "../packages/tasks/src/comments-schema";
import {
  getTaskReview,
  markTaskReviewContinuation,
  reviewTask,
  submitTaskReview,
} from "../packages/tasks/src/review";
import { tasks } from "../packages/tasks/src/schema";
import { getCursor, inWorkspace } from "../packages/workspaces/src";
import { members, workspaces } from "../packages/workspaces/src/schema";
import { startNativeTestApp } from "./fixtures/native-app";

describe("Task review lifecycle with real private PostgreSQL and current authority", () => {
  let app: Awaited<ReturnType<typeof startNativeTestApp>>;
  let owner: { id: string; workspaceId: string };
  let worker: { id: string; workspaceId: string };
  let viewer: { id: string; workspaceId: string };
  let projectId: string;
  let agentId: string;
  let chatId: string;
  let cookie: string;
  const cursors = createCursorCodec(crypto.randomUUID() + crypto.randomUUID());
  const scope = <T>(
    userId: string,
    work: Parameters<typeof inWorkspace<T>>[3],
    actingAgentId?: string,
  ) =>
    inWorkspace(
      app.database.db,
      owner.workspaceId,
      { userId, agentId: actingAgentId },
      work,
      true,
      cursors,
    );
  const fresh = (recurrence?: string) =>
    scope(owner.id, (c) =>
      createTask(c, {
        projectId,
        title: "Review work",
        recurrence,
        assigneeAgentIds: [agentId],
      }),
    );
  const submit = (task: Awaited<ReturnType<typeof fresh>>) =>
    scope(
      worker.id,
      (c) =>
        submitTaskReview(c, task.id, {
          editToken: task.editToken,
          body: "Implemented the result. Evidence: https://example.com/fixture",
          chatId,
        }),
      agentId,
    );
  const snapshot = async () => ({
    cursor: await scope(owner.id, getCursor),
    tasks: await app.database.db.select().from(tasks),
    comments: await app.database.db.select().from(taskComments),
    reviews: await app.database.db.select().from(taskReviews),
  });

  beforeAll(async () => {
    app = await startNativeTestApp();
    const person = await app.provisionUser({
      name: "Review owner",
      role: "owner",
    });
    owner = person;
    const login = await fetch(`${app.apiOrigin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { origin: app.origin, "content-type": "application/json" },
      body: JSON.stringify({ email: person.email, password: person.password }),
    });
    expect(login.status).toBe(200);
    cookie = login.headers.get("set-cookie") ?? "";
    worker = await app.provisionUser({
      name: "Review worker",
      role: "contributor",
    });
    viewer = await app.provisionUser({ name: "Review viewer", role: "viewer" });
    await scope(owner.id, async (c) => {
      projectId = (await createProject(c, { title: "Review project" })).id;
      await upsertProjectMember(c, projectId, worker.id, "contributor");
      await upsertProjectMember(c, projectId, viewer.id, "viewer");
      agentId = (
        await createAgent(c, {
          title: "Review agent",
          projectId,
          instructions: "Fixture worker",
          model: "openai/gpt-4.1-mini",
          visibility: "workspace",
        })
      ).id;
      chatId = (
        await createChat(c, {
          title: "Existing source chat",
          projectId,
          visibility: "workspace",
        })
      ).id;
      await createParticipant(c, chatId, { agentId, role: "contributor" });
    });
  });
  afterAll(async () => {
    await app?.stop();
  });

  it("preserves the three stored stages and filters backlog/review before bounded paging", async () => {
    const pending = await fresh();
    expect(pending.status).toBe("todo");
    const backlog = await scope(owner.id, (c) =>
      setTaskStatus(c, pending.id, {
        status: "backlog",
        editToken: pending.editToken,
      }),
    );
    const progress = await scope(
      worker.id,
      (c) =>
        setTaskStatus(c, backlog.id, {
          status: "doing",
          editToken: backlog.editToken,
        }),
      agentId,
    );
    expect(progress.status).toBe("doing");
    const review = await submit(progress);
    expect(review.task.status).toBe("review");
    const listed = await scope(owner.id, (c) =>
      getTasks(c, { projectId, status: "review", limit: 1 }),
    );
    expect(listed.items[0]?.id).toBe(pending.id);
    const response = await fetch(
      `${app.apiOrigin}/api/workspaces/${owner.workspaceId}/tasks?projectId=${projectId}&status=review`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).items[0].status).toBe("review");
    const invalid = await fetch(
      `${app.apiOrigin}/api/workspaces/${owner.workspaceId}/tasks/${pending.id}/status`,
      {
        method: "POST",
        headers: {
          cookie,
          origin: app.origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: "review",
          editToken: review.task.editToken,
        }),
      },
    );
    expect(invalid.status).toBe(400);
  });

  it("persists a source-chat review summary and owner Inbox attention, without completing the task", async () => {
    const task = await fresh();
    const result = await submit(task);
    expect(result).toMatchObject({
      chatId,
      agentId,
      task: {
        status: "review",
        ownerId: owner.id,
        editToken: task.editToken + 1,
      },
      comment: { agentId, createdBy: worker.id },
    });
    expect(
      await scope(owner.id, (c) => getTaskReview(c, task.id)),
    ).toMatchObject({
      taskId: task.id,
      chatId,
      agentId,
      comment: { id: result.comment.id },
    });
    const attention = await scope(owner.id, (c) =>
      getTaskNotifications(c, { limit: 100 }),
    );
    expect(attention.items.some((item) => item.id === result.comment.id)).toBe(
      true,
    );
    expect((await scope(owner.id, (c) => getTask(c, task.id))).status).toBe(
      "review",
    );
    await expect(
      scope(
        worker.id,
        (c) =>
          updateTaskComment(c, result.comment.id, {
            body: "Rewritten evidence",
          }),
        agentId,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scope(worker.id, (c) => deleteTaskComment(c, result.comment.id), agentId),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses stale, empty, oversized and revoked submissions but preserves authorized archived output", async () => {
    const task = await fresh(
      "DTSTART;TZID=UTC:20260101T120000\nRRULE:FREQ=DAILY",
    );
    const before = await snapshot();
    for (const input of [
      { editToken: task.editToken + 1, body: "Summary" },
      { editToken: task.editToken, body: " " },
      { editToken: task.editToken, body: "é".repeat(5001) },
    ]) {
      await expect(
        scope(worker.id, (c) => submitTaskReview(c, task.id, input), agentId),
      ).rejects.toMatchObject({
        code: input.body === "Summary" ? "conflict" : "invalid",
      });
    }
    await expect(
      scope(viewer.id, (c) =>
        submitTaskReview(c, task.id, {
          editToken: task.editToken,
          body: "Reader attempt",
        }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await snapshot()).toEqual(before);
    const archived = await scope(owner.id, (c) =>
      archiveTask(c, task.id, true, task.editToken),
    );
    const archivedReview = await submit(archived);
    expect(archivedReview.task).toMatchObject({
      archived: true,
      status: "review",
    });
    const archivedCompletion = await scope(owner.id, (c) =>
      reviewTask(c, task.id, {
        requestId: crypto.randomUUID(),
        editToken: archivedReview.task.editToken,
        decision: "approve",
      }),
    );
    expect(archivedCompletion.task).toMatchObject({
      archived: true,
      status: "done",
      successorId: null,
    });
    const active = await fresh();
    await app.database.db
      .delete(projectMembers)
      .where(eq(projectMembers.userId, worker.id));
    const afterRevoke = await snapshot();
    await expect(submit(active)).rejects.toMatchObject({ code: "forbidden" });
    expect(await snapshot()).toEqual(afterRevoke);
    await scope(owner.id, (c) =>
      upsertProjectMember(c, projectId, worker.id, "contributor"),
    );
  });

  it("only permits authorized human review, not agents or a generic status bypass", async () => {
    const result = await submit(await fresh());
    const input = {
      requestId: crypto.randomUUID(),
      editToken: result.task.editToken,
      decision: "approve" as const,
    };
    const before = await snapshot();
    await expect(
      scope(worker.id, (c) => reviewTask(c, result.task.id, input)),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scope(owner.id, (c) => reviewTask(c, result.task.id, input), agentId),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scope(owner.id, (c) =>
        setTaskStatus(c, result.task.id, {
          status: "done",
          editToken: result.task.editToken,
        }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await snapshot()).toEqual(before);
    const pending = await fresh();
    await expect(
      scope(
        worker.id,
        (c) =>
          setTaskStatus(c, pending.id, {
            status: "done",
            editToken: pending.editToken,
          }),
        agentId,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("requests changes with feedback in the same source chat and replays the exact decision receipt", async () => {
    const review = await submit(await fresh());
    const input = {
      requestId: crypto.randomUUID(),
      editToken: review.task.editToken,
      decision: "request_changes" as const,
      body: "Please add the missing acceptance evidence.",
    };
    const before = await snapshot();
    await expect(
      scope(owner.id, (c) =>
        reviewTask(c, review.task.id, { ...input, body: " " }),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      scope(owner.id, (c) =>
        reviewTask(c, review.task.id, {
          ...input,
          editToken: input.editToken + 1,
        }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await snapshot()).toEqual(before);
    const changed = await scope(owner.id, (c) =>
      reviewTask(c, review.task.id, input),
    );
    expect(changed).toMatchObject({
      chatId,
      agentId,
      task: { status: "doing", editToken: input.editToken + 1 },
      comment: {
        agentId: null,
        createdBy: owner.id,
        body: `Changes requested\n\n${input.body}`,
      },
    });
    const after = await snapshot();
    expect(
      await scope(owner.id, (c) => getTaskReview(c, review.task.id)),
    ).toMatchObject({ continuationStatus: "pending", decisionRequest: input });
    expect(
      await scope(worker.id, (c) => getTaskReview(c, review.task.id)),
    ).toMatchObject({ decisionRequest: null });
    expect(
      await scope(owner.id, (c) => getTaskReview(c, review.task.id), agentId),
    ).toMatchObject({ decisionRequest: null });
    expect(
      await scope(owner.id, (c) => reviewTask(c, review.task.id, input)),
    ).toEqual(changed);
    expect(await snapshot()).toEqual(after);
    await expect(
      scope(worker.id, (c) =>
        markTaskReviewContinuation(c, review.task.id, input.requestId, "sent"),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await scope(owner.id, (c) =>
      markTaskReviewContinuation(
        c,
        review.task.id,
        input.requestId,
        "unavailable",
      ),
    );
    expect(
      await scope(owner.id, (c) => getTaskReview(c, review.task.id)),
    ).toMatchObject({
      continuationStatus: "unavailable",
      decisionRequest: input,
    });
    await scope(owner.id, (c) =>
      markTaskReviewContinuation(c, review.task.id, input.requestId, "sent"),
    );
    const notified = await snapshot();
    await scope(owner.id, (c) =>
      markTaskReviewContinuation(
        c,
        review.task.id,
        input.requestId,
        "unavailable",
      ),
    );
    expect(await snapshot()).toEqual(notified);
    await expect(
      scope(owner.id, (c) =>
        reviewTask(c, review.task.id, { ...input, body: "Different feedback" }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await snapshot()).toEqual(notified);
    const comments = await scope(owner.id, (c) =>
      getTaskComments(c, { taskId: review.task.id }),
    );
    expect(comments.items).toHaveLength(2);
    expect(comments.immutableIds.sort()).toEqual(
      [review.comment.id, changed.comment.id].sort(),
    );
    const resubmitted = await submit(changed.task);
    expect(resubmitted.task.status).toBe("review");
    expect(resubmitted.chatId).toBe(chatId);
    const latest = await snapshot();
    expect(
      await scope(owner.id, (c) => reviewTask(c, review.task.id, input)),
    ).toEqual(changed);
    expect(await snapshot()).toEqual(latest);
    expect(
      (await scope(owner.id, (c) => getTask(c, review.task.id))).status,
    ).toBe("review");
    await expect(
      scope(worker.id, (c) => deleteTaskComment(c, review.comment.id), agentId),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scope(owner.id, (c) =>
        updateTaskComment(c, changed.comment.id, {
          body: "Overwritten changes",
        }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const approved = await scope(owner.id, (c) =>
      reviewTask(c, resubmitted.task.id, {
        requestId: crypto.randomUUID(),
        editToken: resubmitted.task.editToken,
        decision: "approve",
      }),
    );
    expect(approved.task.status).toBe("done");
    const final = await snapshot();
    expect(
      await scope(owner.id, (c) => reviewTask(c, review.task.id, input)),
    ).toEqual(changed);
    expect(await snapshot()).toEqual(final);
  });

  it("approves once with recurrence and rolls concurrent stale decisions back", async () => {
    const review = await submit(
      await fresh("DTSTART;TZID=UTC:20260101T120000\nRRULE:FREQ=DAILY"),
    );
    const input = {
      requestId: crypto.randomUUID(),
      editToken: review.task.editToken,
      decision: "approve" as const,
    };
    const decisions = await Promise.allSettled([
      scope(owner.id, (c) => reviewTask(c, review.task.id, input)),
      scope(owner.id, (c) =>
        reviewTask(c, review.task.id, {
          ...input,
          requestId: crypto.randomUUID(),
        }),
      ),
    ]);
    expect(
      decisions.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const completed = await scope(owner.id, (c) => getTask(c, review.task.id));
    expect(completed.status).toBe("done");
    expect(completed.successorId).toBeTruthy();
    const successor = await scope(owner.id, (c) =>
      getTask(c, completed.successorId ?? ""),
    );
    expect(successor).toMatchObject({
      predecessorId: completed.id,
      status: "todo",
      ownerId: owner.id,
      assigneeAgentIds: [agentId],
    });
    expect(
      await app.database.db
        .select()
        .from(tasks)
        .where(eq(tasks.predecessorId, completed.id)),
    ).toHaveLength(1);
    expect(
      (
        await scope(owner.id, (c) =>
          getTaskComments(c, { taskId: completed.id }),
        )
      ).items,
    ).toHaveLength(2);
  });

  it("denies archived agents and validates the exact native review action vocabulary", async () => {
    const task = await fresh();
    await scope(owner.id, (c) => archiveAgent(c, agentId, true));
    const before = await snapshot();
    await expect(submit(task)).rejects.toMatchObject({ code: "forbidden" });
    expect(await snapshot()).toEqual(before);
    await scope(owner.id, (c) => archiveAgent(c, agentId, false));
    expect(
      nativeActionInput.parse({
        type: "task.review",
        id: task.id,
        requestId: crypto.randomUUID(),
        editToken: task.editToken,
        decision: "request_changes",
        body: "Supply evidence",
      }).type,
    ).toBe("task.review");
    expect(() =>
      nativeActionInput.parse({
        type: "task.review",
        id: task.id,
        editToken: task.editToken,
        decision: "approve",
      }),
    ).toThrow();
  });

  it("enforces source comment/task and source chat/workspace associations in PostgreSQL", async () => {
    const task = await fresh();
    const other = await fresh();
    const otherComment = await scope(owner.id, (c) =>
      createTaskComment(c, {
        taskId: other.id,
        body: "Different task evidence",
      }),
    );
    const before = await snapshot();
    await expect(
      app.database.db.insert(taskReviews).values({
        workspaceId: owner.workspaceId,
        taskId: task.id,
        commentId: otherComment.id,
        editToken: task.editToken + 1,
      }),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    const foreignWorkspace = (
      await app.database.db
        .insert(workspaces)
        .values({ title: "Foreign review source" })
        .returning()
    )[0];
    if (!foreignWorkspace) throw new Error("Fixture workspace missing");
    await app.database.db.insert(members).values({
      workspaceId: foreignWorkspace.id,
      userId: owner.id,
      role: "owner",
    });
    const foreignChat = await inWorkspace(
      app.database.db,
      foreignWorkspace.id,
      { userId: owner.id },
      (c) =>
        createChat(c, {
          title: "Foreign source chat",
          visibility: "workspace",
        }),
    );
    const beforeForeign = await snapshot();
    await expect(
      scope(owner.id, (c) =>
        submitTaskReview(c, task.id, {
          editToken: task.editToken,
          body: "Attempted foreign source",
          chatId: foreignChat.id,
        }),
      ),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(beforeForeign);
  });
});
