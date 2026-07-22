export {
  enqueueNoteIndexing,
  getRelatedNotes,
  getRelationStatus,
  nativeRelationsAvailable,
  pauseKnowledgeRelations,
  rebuildKnowledgeRelations,
  rejectAutomaticRelation,
  removeNoteFromKnowledgeIndex,
  restoreAutomaticRelation,
  resumeKnowledgeRelations,
  subscribeToRelationEvents,
  syncAndEnqueueNote,
  syncKnowledgeNotes,
  type RelationCommandError
} from "./tauri-relations-client";
