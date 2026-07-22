#[path = "model_resource_manifest.rs"]
mod model_resource_manifest;

use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=resources/models/embeddinggemma-300m-q4");
    // O ícone do executável é compilado em `resource.lib`. Sem esta pista,
    // o Cargo pode reutilizar o recurso anterior mesmo após `tauri icon`.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    let manifest_path =
        PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("manifest dir"))
            .join("resources/models/embeddinggemma-300m-q4/model-manifest.json");
    model_resource_manifest::load_and_validate_manifest(&manifest_path)
        .unwrap_or_else(|error| panic!("EmbeddingGemma resource validation failed: {error}"));
    tauri_build::build();
}
