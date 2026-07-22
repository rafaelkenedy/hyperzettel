use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Component, Path, PathBuf},
};

use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelResourceManifest {
    pub id: String,
    pub variant: String,
    pub pipeline_version: String,
    pub onnx_file: String,
    pub external_data_files: Vec<String>,
    pub tokenizer_file: String,
    pub config_file: String,
    pub tokenizer_config_file: String,
    pub special_tokens_map_file: Option<String>,
    pub added_tokens_file: Option<String>,
    pub dimensions: usize,
    pub persisted_dimensions: usize,
    pub maximum_input_tokens: usize,
    pub sha256: BTreeMap<String, String>,
}

impl ModelResourceManifest {
    pub fn required_files(&self) -> BTreeSet<&str> {
        let mut files = BTreeSet::from([
            self.onnx_file.as_str(),
            self.tokenizer_file.as_str(),
            self.config_file.as_str(),
            self.tokenizer_config_file.as_str(),
        ]);
        files.extend(self.external_data_files.iter().map(String::as_str));
        files.extend(self.special_tokens_map_file.as_deref());
        files.extend(self.added_tokens_file.as_deref());
        files
    }
}

pub fn load_and_validate_manifest(manifest_path: &Path) -> Result<ModelResourceManifest, String> {
    let manifest_bytes = fs::read(manifest_path)
        .map_err(|error| format!("failed to read {}: {error}", manifest_path.display()))?;
    let manifest: ModelResourceManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("invalid {}: {error}", manifest_path.display()))?;
    let root = manifest_path
        .parent()
        .ok_or_else(|| "model manifest has no parent directory".to_owned())?;
    validate_manifest(root, &manifest)?;
    Ok(manifest)
}

pub fn validate_manifest(root: &Path, manifest: &ModelResourceManifest) -> Result<(), String> {
    if manifest.id.trim().is_empty()
        || manifest.variant.trim().is_empty()
        || manifest.pipeline_version.trim().is_empty()
    {
        return Err("model identity fields must not be empty".to_owned());
    }
    if manifest.persisted_dimensions > manifest.dimensions {
        return Err("persisted dimensions exceed source dimensions".to_owned());
    }
    if manifest.maximum_input_tokens == 0 {
        return Err("maximum input tokens must be positive".to_owned());
    }

    let required = manifest.required_files();
    for relative in &required {
        if !manifest.sha256.contains_key(*relative) {
            return Err(format!(
                "missing SHA-256 for required model file {relative}"
            ));
        }
    }

    for (relative, expected_hash) in &manifest.sha256 {
        let path = safe_resource_path(root, relative)?;
        let contents = fs::read(&path).map_err(|error| {
            format!("failed to read model resource {}: {error}", path.display())
        })?;
        let actual_hash = hex::encode(Sha256::digest(contents));
        if !actual_hash.eq_ignore_ascii_case(expected_hash) {
            return Err(format!(
                "SHA-256 mismatch for {relative}: expected {expected_hash}, got {actual_hash}"
            ));
        }
    }

    Ok(())
}

fn safe_resource_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!("unsafe model resource path: {relative}"));
    }
    Ok(root.join(relative_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_that_escape_the_resource_directory() {
        assert!(safe_resource_path(Path::new("model"), "../secret").is_err());
        assert!(safe_resource_path(Path::new("model"), "C:/secret").is_err());
    }
}
