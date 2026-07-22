export type NoteRelation = {
  id: string;
  firstNoteId: string;
  secondNoteId: string;
  score: number;
  kind: "semantic";
  origin: "automatic" | "manual";
  modelId: string;
  pipelineVersion: string;
  firstRevision: string;
  secondRevision: string;
  createdAt: string;
  updatedAt: string;
};

export function relationIncludes(relation: NoteRelation, noteId: string): boolean {
  return relation.firstNoteId === noteId || relation.secondNoteId === noteId;
}
