#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RelationConfig {
    pub model_id: &'static str,
    pub model_variant: &'static str,
    pub pipeline_version: &'static str,
    pub source_dimensions: usize,
    pub persisted_dimensions: usize,
    pub maximum_input_tokens: usize,
    pub candidate_limit: usize,
    pub maximum_relations_per_note: usize,
    pub minimum_similarity: f32,
    pub indexing_batch_size: usize,
    pub reciprocal_relations_only: bool,
}

pub const RELATION_CONFIG: RelationConfig = RelationConfig {
    model_id: "onnx-community/embeddinggemma-300m-ONNX",
    model_variant: "model_no_gather_q4",
    pipeline_version: "embeddinggemma-fastembed-q4-256-v1",
    source_dimensions: 768,
    persisted_dimensions: 256,
    maximum_input_tokens: 2_048,
    candidate_limit: 20,
    maximum_relations_per_note: 5,
    minimum_similarity: 0.68,
    indexing_batch_size: 4,
    reciprocal_relations_only: false,
};
