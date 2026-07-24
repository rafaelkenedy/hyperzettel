# Notices

Hyperzettel's **source code** is licensed under the **MIT License** (see `LICENSE`).

This application bundles third-party components under **their own licenses**:

## Bundled AI model - EmbeddingGemma-300m

`src-tauri/resources/models/embeddinggemma-300m-q4/` contains Google's **EmbeddingGemma** weights, which are **not** MIT. They are distributed under Google's **Gemma Terms of Use** and its **Prohibited Use Policy**:

- Gemma Terms of Use: [https://ai.google.dev/gemma/terms](https://ai.google.dev/gemma/terms)
- The Gemma license and use restrictions must be passed along when redistributing the model or model derivatives; the license files are shipped in the installer under `resources/licenses/`.
- **The code license (MIT) does not apply to the model.** Users and redistributors of Hyperzettel must comply with the Gemma Terms for the bundled model.

## Runtime dependencies

Frontend (React, CodeMirror, Tailwind, lucide-react, etc.) and Rust crates are used under their respective permissive licenses (mostly MIT / Apache-2.0). Run `npm run` license tooling / `cargo about` to generate a full third-party report before a public release.

---

*If you fork or redistribute Hyperzettel, keep this NOTICE and the Gemma license files.*
