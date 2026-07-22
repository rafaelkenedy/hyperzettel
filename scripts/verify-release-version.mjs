import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function read(path) {
  return readFile(resolve(root, path), "utf8");
}

function packageVersionFromToml(source) {
  let inPackage = false;

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "[package]") {
      inPackage = true;
      continue;
    }
    if (inPackage && trimmed.startsWith("[")) break;

    const match = inPackage && trimmed.match(/^version\s*=\s*"([^"]+)"$/);
    if (match) return match[1];
  }

  throw new Error("Versão não encontrada em src-tauri/Cargo.toml.");
}

function packageVersionFromCargoLock(source, packageName) {
  for (const block of source.split("[[package]]").slice(1)) {
    const name = block.match(/^name\s*=\s*"([^"]+)"$/m)?.[1];
    const version = block.match(/^version\s*=\s*"([^"]+)"$/m)?.[1];
    if (name === packageName && version) return version;
  }

  throw new Error(`Versão de ${packageName} não encontrada em src-tauri/Cargo.lock.`);
}

const [packageJson, packageLock, tauriConfig, cargoToml, cargoLock, changelog] =
  await Promise.all([
    read("package.json").then(JSON.parse),
    read("package-lock.json").then(JSON.parse),
    read("src-tauri/tauri.conf.json").then(JSON.parse),
    read("src-tauri/Cargo.toml"),
    read("src-tauri/Cargo.lock"),
    read("CHANGELOG.md")
  ]);

const versions = new Map([
  ["package.json", packageJson.version],
  ["package-lock.json", packageLock.version],
  ["package-lock.json packages['']", packageLock.packages?.[""]?.version],
  ["src-tauri/tauri.conf.json", tauriConfig.version],
  ["src-tauri/Cargo.toml", packageVersionFromToml(cargoToml)],
  ["src-tauri/Cargo.lock", packageVersionFromCargoLock(cargoLock, "hyperzettel")]
]);

const projectVersion = packageJson.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(projectVersion)) {
  throw new Error(`Versão SemVer inválida: ${projectVersion}`);
}

for (const [file, version] of versions) {
  if (version !== projectVersion) {
    throw new Error(`${file} usa ${String(version)}, mas o projeto usa ${projectVersion}.`);
  }
}

const tag = process.argv[2];
if (tag) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error(`A tag deve seguir o formato vX.Y.Z: ${tag}`);
  }
  if (tag.slice(1) !== projectVersion) {
    throw new Error(`A tag ${tag} não corresponde à versão ${projectVersion}.`);
  }
}

if (!changelog.includes(`## [${projectVersion}]`)) {
  throw new Error(`CHANGELOG.md não contém uma seção para ${projectVersion}.`);
}

console.log(`Versão ${projectVersion} sincronizada${tag ? ` com a tag ${tag}` : ""}.`);
