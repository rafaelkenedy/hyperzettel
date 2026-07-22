use crate::knowledge::{
    domain::NoteRelation,
    infrastructure::{RelationRepository, RepositoryError},
};

pub fn get_related_notes(
    note_id: &str,
    repository: &dyn RelationRepository,
) -> Result<Vec<NoteRelation>, RepositoryError> {
    repository.get_for_note(note_id)
}
