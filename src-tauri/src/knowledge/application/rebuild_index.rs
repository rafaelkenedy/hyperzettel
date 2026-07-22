use crate::knowledge::infrastructure::{EmbeddingQueue, IndexReason, IndexRequest, NoteRepository};

use super::RelationServiceError;

pub async fn rebuild_index(
    notes: &dyn NoteRepository,
    queue: &EmbeddingQueue,
) -> Result<usize, RelationServiceError> {
    let requests = notes
        .get_all_active()?
        .into_iter()
        .map(|note| IndexRequest {
            note_id: note.id,
            revision: note.revision,
            reason: IndexReason::ManualRebuild,
        })
        .collect();
    Ok(queue.enqueue_batch(requests).await)
}
