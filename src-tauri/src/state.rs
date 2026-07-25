use std::sync::Arc;

use tauri::Manager;
use thiserror::Error;

use crate::{
    database::{Database, DatabaseError},
    knowledge::{
        application::{RelationApplicationService, RelationServiceError},
        domain::RELATION_CONFIG,
        infrastructure::{
            resolve_model_directory, EmbeddingService, ModelLoadError, ModelLoader,
            RelationRepository, RepositoryError, SqliteEmbeddingRepository, SqliteNoteRepository,
            SqliteRelationRepository,
        },
    },
    note_index::SqliteNoteIndex,
    vault::{VaultError, VaultStore},
};

pub struct AppState {
    pub relation_service: Arc<RelationApplicationService>,
    /// Fonte da verdade das notas: um arquivo `.html` por nota (ADR 0006).
    pub vault: Arc<VaultStore>,
    /// Índice derivado (metadados, busca FTS, conexões, retenção).
    pub note_index: Arc<SqliteNoteIndex>,
}

#[derive(Debug, Error)]
pub enum StateBuildError {
    #[error("failed to resolve the application data directory")]
    AppDataDirectory,
    #[error(transparent)]
    Database(#[from] DatabaseError),
    #[error(transparent)]
    Model(#[from] ModelLoadError),
    #[error(transparent)]
    Service(#[from] RelationServiceError),
    #[error(transparent)]
    Repository(#[from] RepositoryError),
    #[error(transparent)]
    Vault(#[from] VaultError),
}

pub fn build_app_state(app: tauri::AppHandle) -> Result<AppState, StateBuildError> {
    let data_directory = app
        .path()
        .app_data_dir()
        .map_err(|_| StateBuildError::AppDataDirectory)?;
    let database = Database::open(&data_directory.join("hyperzettel.sqlite"))?;
    let vault = Arc::new(VaultStore::open(data_directory.join("vault"))?);
    let model_directory = resolve_model_directory(&app)?;
    let model_loader = ModelLoader::from_directory(model_directory)?;

    let embedding_repository = Arc::new(SqliteEmbeddingRepository::new(database.clone()));
    let relation_repository = Arc::new(SqliteRelationRepository::new(database.clone()));
    let note_index = Arc::new(SqliteNoteIndex::new(database.clone()));
    let note_repository = Arc::new(SqliteNoteRepository::new(database));
    let relation_service = RelationApplicationService::new(
        Arc::new(EmbeddingService::new(model_loader)),
        embedding_repository,
        relation_repository.clone(),
        note_repository,
    );
    relation_service.attach_app_handle(app)?;
    relation_service.start_queue();

    if relation_repository
        .get_checkpoint()?
        .is_some_and(|checkpoint| {
            checkpoint.pipeline_version != RELATION_CONFIG.pipeline_version
                || checkpoint.status != "completed"
        })
    {
        let service = Arc::clone(&relation_service);
        tauri::async_runtime::spawn(async move {
            let _ = service.rebuild().await;
        });
    }

    Ok(AppState {
        relation_service,
        vault,
        note_index,
    })
}
