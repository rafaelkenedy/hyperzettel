export type RelationStatus =
  | { type: "idle" }
  | { type: "loading-model" }
  | { type: "indexing"; processed: number; total: number; currentNoteId?: string }
  | { type: "ready"; relationCount: number }
  | { type: "paused"; processed: number; total: number }
  | { type: "error"; code: string; message: string; retryable: boolean };

export type RelationMetrics = {
  modelLoadDurationMs: number;
  tokenizationDurationMs: number;
  inferenceDurationMs: number;
  normalizationDurationMs: number;
  similaritySearchDurationMs: number;
  persistenceDurationMs: number;
  batchSize: number;
  inputTokens: number;
  candidateCount: number;
  relationCount: number;
  truncated: boolean;
};
