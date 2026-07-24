# Security Policy

## Supported versions

Hyperzettel is pre-1.0 (`0.y.z`); security fixes land on the latest release only.

## Reporting a vulnerability

Please report security issues **privately**, not via public issues:

- Open a [GitHub private security advisory](../../security/advisories/new), or
- email the maintainer (k.rafaelalves@gmail.com).

Please include steps to reproduce, affected version, and impact. Target first response: **72 hours**; coordinated disclosure once a fix is available.

## Scope & posture

Hyperzettel is a **local-first desktop app** (Tauri): your notes stay on your device; there is no server, account, or telemetry.

- **Least-privilege capabilities** - the app grants only window controls (`src-tauri/capabilities/default.json`); no filesystem/shell/network permissions are exposed broadly.
- **Content Security Policy** - set in `src-tauri/tauri.conf.json` (`app.security.csp`).
- **Untrusted content** - note content is treated as untrusted; HTML is sanitized before rendering (`src/shared/html.ts`).

## Known follow-ups

- Dependency scanning (`npm audit`, `cargo audit`) and secret scanning run in CI.
- Encryption-at-rest for notes: **not applied at the application level by design**. Notes are stored locally; at-rest protection relies on **OS full-disk encryption** (BitLocker / FileVault / LUKS) - please enable it. Rationale: durable, transparent access to your own notes is prioritized over confidentiality against local attackers for this personal, local-first tool.
