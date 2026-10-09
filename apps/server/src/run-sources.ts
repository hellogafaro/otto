import { getChat, isAttachedToReadableChat } from "@otto/chats";
import { getDocument, getDocumentAudience } from "@otto/documents";
import { requireFileAudience } from "@otto/files";
import { getProjectAudience } from "@otto/projects";
import type { AuthorizeSources } from "@otto/runs/runtime";
import { DomainError } from "@otto/shared";
import { getSkill, getSkillAudience } from "@otto/skills";
import { getTask } from "@otto/tasks";

export const authorizeRunSources: AuthorizeSources = async (
  c,
  run,
  sources = [],
) => {
  const ids = new Set(
    run.inputs.context?.messages.flatMap((message) => message.fileIds ?? []) ??
      [],
  );
  for (const id of ids) {
    await requireFileAudience(c, id, run.inputs.audience.humans, true);
  }
  for (const source of sources) {
    let audience: string[];
    switch (source.type) {
      case "document": {
        const selected = run.inputs.context?.documents.some(
          (item) => item.id === source.id,
        );
        const sourceContext = selected
          ? { ...c, actor: { userId: run.sponsorId } }
          : c;
        const document = await getDocument(sourceContext, source.id);
        if (
          !selected &&
          document.projectId !== (await getChat(c, run.chatId)).projectId
        )
          throw new DomainError("forbidden", "Retained Document scope changed");
        audience = await getDocumentAudience(sourceContext, source.id);
        break;
      }
      case "task": {
        const task = await getTask(c, source.id);
        if (task.projectId !== (await getChat(c, run.chatId)).projectId)
          throw new DomainError("forbidden", "Retained Task scope changed");
        audience = await getProjectAudience(c, task.projectId);
        break;
      }
      case "file":
        await requireFileAudience(c, source.id, run.inputs.audience.humans);
        continue;
      case "attachment":
        if (
          source.chatId !== run.chatId ||
          !(await isAttachedToReadableChat(c, source.fileId, source))
        )
          throw new DomainError(
            "forbidden",
            "Retained attachment source changed",
          );
        await requireFileAudience(
          c,
          source.fileId,
          run.inputs.audience.humans,
          true,
        );
        continue;
      case "skill-file": {
        const selected = run.inputs.skills.find(
          (skill) => skill.documentId === source.skillId,
        );
        if (
          !selected?.supportingFiles?.some(
            (file) =>
              file.path === source.path &&
              file.artifactId === source.fileId &&
              file.sha256 === source.sha256 &&
              file.byteLength === source.byteLength,
          )
        )
          throw new DomainError(
            "forbidden",
            "Retained Skill file is not accepted",
          );
        await getSkill(c, source.skillId);
        audience = await getSkillAudience(c, source.skillId);
        const file = await requireFileAudience(
          { ...c, actor: { userId: run.sponsorId } },
          source.fileId,
          run.inputs.audience.humans,
        );
        if (
          file.sha256 !== source.sha256 ||
          file.byteLength !== source.byteLength
        )
          throw new DomainError("conflict", "Retained Skill bytes changed");
        break;
      }
      default:
        throw new DomainError("unavailable", "Unrecognized retained source");
    }
    if (run.inputs.audience.humans.some((id) => !audience.includes(id)))
      throw new DomainError("forbidden", "Retained source audience changed");
  }
};
