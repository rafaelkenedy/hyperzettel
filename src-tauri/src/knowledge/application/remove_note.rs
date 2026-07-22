use crate::knowledge::infrastructure::{RelationRepository, RepositoryError};

pub fn remove_note_from_index(
    note_id: &str,
    repository: &dyn RelationRepository,
) -> Result<(), RepositoryError> {
    repository.delete_for_note(note_id)
}
