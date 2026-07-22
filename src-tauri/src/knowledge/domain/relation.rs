use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RelationOrigin {
    Automatic,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RelationKind {
    Semantic,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRelation {
    pub id: String,
    pub first_note_id: String,
    pub second_note_id: String,
    pub score: f32,
    pub origin: RelationOrigin,
    pub kind: RelationKind,
    pub model_id: String,
    pub pipeline_version: String,
    pub first_revision: String,
    pub second_revision: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RejectedRelation {
    pub id: String,
    pub first_note_id: String,
    pub second_note_id: String,
    pub first_content_hash: String,
    pub second_content_hash: String,
    pub pipeline_version: String,
    pub rejected_at: String,
}

pub fn ordered_note_ids<'a>(first: &'a str, second: &'a str) -> (&'a str, &'a str) {
    if first <= second {
        (first, second)
    } else {
        (second, first)
    }
}

pub fn relation_id(first: &str, second: &str) -> String {
    let (first, second) = ordered_note_ids(first, second);
    let mut hasher = Sha256::new();
    hasher.update(first.as_bytes());
    hasher.update([0]);
    hasher.update(second.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relation_ids_do_not_depend_on_direction() {
        assert_eq!(relation_id("a", "b"), relation_id("b", "a"));
        assert_ne!(relation_id("a", "b"), relation_id("a", "c"));
    }
}
