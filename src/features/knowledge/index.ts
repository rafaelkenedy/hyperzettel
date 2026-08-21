/**
 * API pública do mapa de conhecimento.
 *
 * O modelo é exportado porque o provider e o backup precisam dele; o grafo
 * (`lib/`) e os componentes internos não saem daqui.
 */

export { KnowledgeMap } from "./components/KnowledgeMap";

export {
  createKnowledgeModel,
  type CurvePoint,
  type KnowledgeModel,
  type KnowledgeSnapshot,
  type KnowledgeState,
  type NoteInfo
} from "./model/knowledgeModel";
export { REVIEW_QUALITIES, QUALITY_LABELS, type Quality } from "./model/scheduler";
export type { RetentionLevel } from "./model/retention";

/** O painel de propriedades mostra o vencimento da nota aberta. */
export { dueLabel, LEVEL_TONE } from "./lib/format";

export {
  enqueueNoteIndexing,
  exportRejectedRelations,
  getRelatedNotes,
  importRejectedRelations,
  pauseKnowledgeRelations,
  rebuildKnowledgeRelations,
  removeNoteFromKnowledgeIndex
} from "./application/relations";
export {
  KnowledgeRelationsProvider,
  useKnowledgeRelations,
  type RelatedNoteItem
} from "./ui/relations/KnowledgeRelationsProvider";
export { RelatedNotes } from "./ui/relations/RelatedNotes";
export { RelationSettings } from "./ui/relations/RelationSettings";
export { RelationStatus } from "./ui/relations/RelationStatus";
export type {
  NoteRelation,
  RejectedRelation,
  RelationStatus as KnowledgeRelationStatus
} from "./domain/relations";
