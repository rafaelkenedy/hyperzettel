use std::{fs, path::PathBuf};

use fastembed::{
    EmbeddingModel, InitOptionsUserDefined, OutputKey, Pooling, QuantizationMode, TextEmbedding,
    TokenizerFiles, UserDefinedEmbeddingModel,
};
use tauri::Manager;
use thiserror::Error;

use crate::{
    knowledge::domain::RELATION_CONFIG,
    model_resource_manifest::{load_and_validate_manifest, ModelResourceManifest},
};

const MODEL_RESOURCE_DIRECTORY: &str = "models/embeddinggemma-300m-q4";
const DEVELOPMENT_RESOURCE_DIRECTORY: &str = "resources";
const MODEL_MANIFEST_FILE: &str = "model-manifest.json";
const SENTENCE_EMBEDDING_OUTPUT: &str = "sentence_embedding";

#[derive(Debug, Error)]
pub enum ModelLoadError {
    #[error("failed to resolve the application resource directory")]
    ResourceDirectory,
    #[error("model files are missing")]
    ModelFilesMissing,
    #[error("model resource path escaped the application resource directory")]
    UnsafeResourcePath,
    #[error("model resource integrity validation failed")]
    ModelIntegrityFailed,
    #[error("failed to load the embedding model")]
    ModelLoadFailed,
}

#[derive(Debug, Clone)]
pub struct ModelLoader {
    directory: PathBuf,
    manifest: ModelResourceManifest,
}

impl ModelLoader {
    pub fn from_directory(directory: PathBuf) -> Result<Self, ModelLoadError> {
        let manifest_path = directory.join(MODEL_MANIFEST_FILE);
        if !manifest_path.is_file() {
            return Err(ModelLoadError::ModelFilesMissing);
        }
        let manifest = load_and_validate_manifest(&manifest_path)
            .map_err(|_| ModelLoadError::ModelIntegrityFailed)?;
        validate_manifest_identity(&manifest)?;
        Ok(Self {
            directory,
            manifest,
        })
    }

    pub fn load(&self) -> Result<TextEmbedding, ModelLoadError> {
        let onnx_bytes = self.read(&self.manifest.onnx_file)?;
        let external_relative = self
            .manifest
            .external_data_files
            .first()
            .ok_or(ModelLoadError::ModelFilesMissing)?;
        let external_bytes = self.read(external_relative)?;
        let external_file_name = PathBuf::from(external_relative)
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(ModelLoadError::ModelFilesMissing)?
            .to_owned();

        let tokenizer_files = TokenizerFiles {
            tokenizer_file: self.read(&self.manifest.tokenizer_file)?,
            config_file: self.read(&self.manifest.config_file)?,
            special_tokens_map_file: self.read(
                self.manifest
                    .special_tokens_map_file
                    .as_deref()
                    .ok_or(ModelLoadError::ModelFilesMissing)?,
            )?,
            tokenizer_config_file: self.read(&self.manifest.tokenizer_config_file)?,
        };

        let pooling = expected_pooling()?;
        let quantization = expected_quantization();
        let mut user_model = UserDefinedEmbeddingModel::new(onnx_bytes, tokenizer_files)
            .with_external_initializer(external_file_name, external_bytes)
            .with_pooling(pooling)
            .with_quantization(quantization);
        user_model.output_key = Some(OutputKey::ByName(SENTENCE_EMBEDDING_OUTPUT));

        TextEmbedding::try_new_from_user_defined(
            user_model,
            InitOptionsUserDefined::new().with_max_length(RELATION_CONFIG.maximum_input_tokens),
        )
        .map_err(|_| ModelLoadError::ModelLoadFailed)
    }

    pub fn manifest(&self) -> &ModelResourceManifest {
        &self.manifest
    }

    fn read(&self, relative: &str) -> Result<Vec<u8>, ModelLoadError> {
        fs::read(self.directory.join(relative)).map_err(|_| ModelLoadError::ModelFilesMissing)
    }
}

pub fn resolve_model_directory(app: &tauri::AppHandle) -> Result<PathBuf, ModelLoadError> {
    let resource_root = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(DEVELOPMENT_RESOURCE_DIRECTORY)
    } else {
        app.path()
            .resource_dir()
            .map_err(|_| ModelLoadError::ResourceDirectory)?
    };
    let canonical_root =
        fs::canonicalize(&resource_root).map_err(|_| ModelLoadError::ResourceDirectory)?;
    let model_directory = canonical_root.join(MODEL_RESOURCE_DIRECTORY);
    let canonical_model =
        fs::canonicalize(model_directory).map_err(|_| ModelLoadError::ModelFilesMissing)?;
    if !canonical_model.starts_with(&canonical_root) {
        return Err(ModelLoadError::UnsafeResourcePath);
    }
    ModelLoader::from_directory(canonical_model.clone())?;
    Ok(canonical_model)
}

fn validate_manifest_identity(manifest: &ModelResourceManifest) -> Result<(), ModelLoadError> {
    if manifest.id != RELATION_CONFIG.model_id
        || manifest.variant != RELATION_CONFIG.model_variant
        || manifest.pipeline_version != RELATION_CONFIG.pipeline_version
        || manifest.dimensions != RELATION_CONFIG.source_dimensions
        || manifest.persisted_dimensions != RELATION_CONFIG.persisted_dimensions
        || manifest.maximum_input_tokens != RELATION_CONFIG.maximum_input_tokens
    {
        return Err(ModelLoadError::ModelIntegrityFailed);
    }
    Ok(())
}

fn expected_pooling() -> Result<Pooling, ModelLoadError> {
    TextEmbedding::get_default_pooling_method(&EmbeddingModel::EmbeddingGemma300MQ4)
        .filter(|pooling| *pooling == Pooling::Mean)
        .ok_or(ModelLoadError::ModelLoadFailed)
}

fn expected_quantization() -> QuantizationMode {
    // EmbeddingGemma Q4 is quantized inside the graph. FastEmbed 5.17 marks it
    // as `None` here so batch handling remains enabled; this does not change
    // the Q4 weights described by the model manifest.
    TextEmbedding::get_quantization_mode(&EmbeddingModel::EmbeddingGemma300MQ4)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local_model_directory() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/models/embeddinggemma-300m-q4")
    }

    #[test]
    fn local_manifest_matches_the_pipeline_configuration() {
        let loader = ModelLoader::from_directory(local_model_directory()).expect("model loader");
        validate_manifest_identity(loader.manifest()).expect("matching manifest");
    }

    #[test]
    fn fastembed_pooling_and_quantization_match_embeddinggemma_q4() {
        assert_eq!(expected_pooling().expect("pooling"), Pooling::Mean);
        assert_eq!(expected_quantization(), QuantizationMode::None);
    }

    #[test]
    #[ignore = "loads the real 200 MB EmbeddingGemma model"]
    fn loads_the_real_local_model_without_hugging_face() {
        let loader = ModelLoader::from_directory(local_model_directory()).expect("model loader");
        let mut model = loader.load().expect("local model");
        let embeddings = model
            .embed(
                ["task: sentence similarity | query:\n\nTítulo: teste"],
                Some(1),
            )
            .expect("embedding");
        assert_eq!(embeddings.len(), 1);
        assert_eq!(embeddings[0].len(), RELATION_CONFIG.source_dimensions);
    }
}
