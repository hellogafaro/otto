import type { SnapshotDocuments } from "@otto/runs";
import { DomainError } from "@otto/shared";
import { getDocument, getDocumentAudience } from "./documents";

export const snapshotRunDocuments: SnapshotDocuments = async (
  c,
  documentIds,
  audience,
  phase,
) => {
  const documents = [];
  for (const id of documentIds) {
    const doc = await getDocument(c, id);
    if (phase === "launch" && doc.archived)
      throw new DomainError("conflict", "Document archived");
    const available = await getDocumentAudience(c, id);
    if (
      audience.humans.some((id) => !available.includes(id)) ||
      (doc.visibility === "user" && audience.agents.length > 1)
    )
      throw new DomainError("forbidden", "Document context audience mismatch");
    documents.push({
      id: doc.id,
      title: doc.title,
      body: doc.body,
      editToken: doc.editToken,
    });
  }
  return documents;
};
