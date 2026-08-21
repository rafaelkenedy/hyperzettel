export {
  enqueueNoteIndexing,
  exportRejectedRelations,
  getRelatedNotes,
  getRelationStatus,
  importRejectedRelations,
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
