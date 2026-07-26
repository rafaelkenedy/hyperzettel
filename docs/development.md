# Desenvolvimento e release

Este documento reúne os comandos necessários para desenvolver, validar e
publicar o Hyperzettel no Windows.

## Pré-requisitos

- Git com Git LFS;
- Node.js `^20.19.0` ou `>=22.12.0` e npm;
- Rust `1.77.2` ou mais recente com o target `x86_64-pc-windows-msvc`;
- Microsoft C++ Build Tools com Windows SDK;
- Microsoft Edge WebView2 Runtime.

## Preparar o ambiente

```powershell
git lfs install
git lfs pull
git lfs fsck
npm ci
```

O modelo EmbeddingGemma pertence ao repositório e usa Git LFS. Um clone que
contenha apenas o ponteiro de
`model_no_gather_q4.onnx_data` falha na validação de integridade.

## Executar

Aplicativo desktop:

```powershell
npm run tauri dev
```

Interface web:

```powershell
npm run dev
```

O modo web não executa o backend Rust, o SQLite nem as relações semânticas.

## Validar

```powershell
npm run lint
npm run typecheck
npm test
npm run build

cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cd ..
```

Os testes que carregam o modelo real são opt-in:

```powershell
cd src-tauri
cargo test real_pipeline_reuses_cache_and_updates_incrementally -- --ignored --nocapture
cargo test benchmark_embeddinggemma --release -- --ignored --nocapture
cargo test --release --test benchmark_retrieval benchmark_lexical_semantic_and_hybrid_retrieval -- --ignored --nocapture
cd ..
```

Um vault HTML multidomínio pode ser criado localmente para o benchmark de
recuperação:

```powershell
npm run benchmark:vault:prepare
$env:HYPERZETTEL_RETRIEVAL_FIXTURE = "$PWD\.benchmark-vault"
cd src-tauri
cargo test --release --test benchmark_retrieval benchmark_lexical_semantic_and_hybrid_retrieval -- --ignored --nocapture
cd ..
```

## Gerar o instalador

```powershell
npm run tauri -- build --bundles nsis
```

O instalador é gravado em
`src-tauri/target/release/bundle/nsis/Hyperzettel_<versão>_x64-setup.exe`.

## Publicar uma versão

Mantenha a mesma versão em `package.json`, `package-lock.json`,
`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` e
`src-tauri/tauri.conf.json`. Depois valide, crie e envie a tag:

```powershell
$releaseVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
$releaseTag = "v$releaseVersion"
npm run release:verify -- $releaseTag
git tag -a $releaseTag -m "Hyperzettel $releaseTag"
git push origin main
git push origin $releaseTag
```

O workflow de CI valida pushes e pull requests para `main`. O workflow de
release responde a tags `v*`, baixa os arquivos LFS, executa as suítes, gera o
NSIS em um runner Windows e publica o instalador na GitHub Release.

Não reposicione uma tag publicada. Para corrigir uma versão, incremente a
versão e crie outra tag.

## Regenerar os ícones

```powershell
npm run tauri -- icon src-tauri/app-icon.svg
```

O arquivo-fonte é `src-tauri/app-icon.svg`; os arquivos gerados em
`src-tauri/icons` também pertencem ao repositório.

## Licenças

Os termos de distribuição do EmbeddingGemma ficam em
`src-tauri/resources/licenses`. Eles não substituem a licença do código do
projeto. O repositório ainda não contém um arquivo de licença de software.
