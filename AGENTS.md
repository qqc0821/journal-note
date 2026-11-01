# Agent Instructions

## User Agreements

- Write every `AGENTS.md`, including nested files and future edits, entirely in English.
- Reply in Chinese unless requested otherwise; preserve the Chinese product UI.
- Provide Git mutation commands for the user to execute. Do not stage, commit, fetch, pull, push, switch branches, change Git configuration, or rewrite history without new explicit execution authorization. Read-only inspection is allowed.
- A request for a commit message means return an English Conventional Commits message, not execute a commit.
- Publishing, uploading installers, signing, and notarizing require explicit authorization; local builds do not authorize publication.

## Build and Verify

Run commands from the repository root. `package.json` and `package-lock.json` define the current toolchain.

| Task | Command and prerequisite |
| --- | --- |
| Install locked dependencies | `npm ci` (postinstall rebuilds native dependencies) |
| Run the desktop app | `npm start` (builds first); `npm run dev` starts Vite only |
| Check UI types and build renderer | `npm run build` |
| Test persistence | `npm test` |
| Test desktop interactions | `npm run build` then `npm run test:ui` |
| Build a local macOS app | `npm run package` |
| Test the arm64 app bundle | After packaging: `JOURNAL_PACKAGED=1 node tests/electron-smoke.cjs` |

- `main.cjs` loads `dist/index.html`. UI tests do not build it; rebuild after renderer changes or the test exercises stale code.
- `npm test` uses Electron's bundled Node to match `better-sqlite3`'s ABI. Do not substitute system `node --test`; run `npm run rebuild` after an ABI mismatch or Electron upgrade.
- Packaged smoke tests hardcode `release/mac-arm64/Journal Note.app`; passing them does not establish Intel support. Repackage after changing any shipped source before testing the bundle.
- `npm run build` checks `src/` TypeScript, not `electron/*.cjs`. For changed CJS files, run `node --check <file>` and relevant runtime tests.
- For persistence changes, run `npm test` and cover the affected failure path. For editor, navigation, IPC, or shutdown changes, also run the desktop interaction test.
- Inspect normal and narrow windows after layout changes, and both themes after color changes. A smoke-test exit code alone does not verify screenshot quality.
- For documentation-only or ignore-rule changes, inspect the content and applicable rules; skip application builds and tests.
- Report the commands actually run, failures, skipped checks, and remaining limits. Earlier test results do not validate later changes.

## Boundaries That Matter

- The renderer in `src/` calls named preload APIs. `electron/preload.cjs` bridges to `main.cjs`, which validates the sender and delegates storage to `data.cjs` / `store.cjs` in a utility process.
- Keep SQLite connections and serialized storage work in the data process. Do not move synchronous database work into window handlers or expose filesystem access, raw SQL, or unrestricted IPC to the renderer.
- IPC changes may require coordinated edits in the renderer, preload method list, main handlers, and data-process allowlist. Check all four rather than adding only a UI call.
- Preserve `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and the CSP in `index.html`; do not relax them to fix a loading problem.
- Electron entry points are CommonJS. The build uses Vite and electron-builder; the older Forge proposal is not the implemented toolchain.
- `dist/` and `release/` are generated. Edit sources and rebuild; do not patch generated output as the fix.
- Existing source files contain compressed code. Write new or substantially edited blocks in multiline form without reformatting unrelated code.

## Persistence Invariants

- `content_json` is authoritative. Update derived `plain_text` with it in the same transaction; do not create a competing HTML or renderer-storage source of truth.
- `entry_date` is a local `YYYY-MM-DD` calendar value, not a UTC timestamp. Timezone changes must not move entries to another day.
- The `active_date` partial unique index permits one non-deleted entry per date. Trash can contain that date too; restore must report a collision instead of overwriting.
- Opening an empty date must not insert an entry. A failed read must not become an editable empty document that can overwrite the original.
- Preserve revision checks, mutation IDs, and serialized saves. An acknowledgement for an older edit must not mark newer editor content as saved.
- Flush pending edits before date switches, deletion, or window/app exit. A failed flush retains content and offers retry or export; a timeout is not success.
- Changes around `setContent`, `setEditable`, and mode transitions must preserve IME composition, selection, and undo behavior. After restoring from trash, verify that new edits persist, not merely that the entry reappears.
- Images use managed `journal-asset://` identifiers. Finish durable file writes before persisting references; never store the user's original absolute file path.
- Orphaned images are deliberately retained. Do not add cleanup without protecting trash, undo sessions, pending edits, and backup references.
- Back up WAL databases through SQLite's backup API, not by copying only `journal.sqlite`.
- Restore validates the database and image hashes, preserves a pre-restore backup, and switches `current.json` to a new generation. Do not overwrite the active database and image directory in place.
- Schema and document-format changes need compatibility and failure handling. Never delete the user's database to make a migration succeed.
- Search currently uses literal, case-sensitive substring matching with inclusive date bounds. Do not replace it with FTS or wildcard matching without preserving short Chinese queries and literal `%` / `_` behavior, or obtaining approval for changed semantics.

## Private Data and Test Isolation

- Tests must use temporary libraries. Set `JOURNAL_TEST_DATA` before launching Electron; never exercise backup, restore, migration, or deletion against the user's normal `userData` directory.
- Keep real journal text, images, backups, credentials, certificates, and personal paths out of fixtures, screenshots, logs, and committed files. Use fictional test content.
- Preserve `.gitignore` coverage for local docs, credentials, databases, backups, exports, and build output. Ignore rules do not remove already tracked secrets; report those separately.
- Validate IPC payloads at runtime, parameterize SQL, and preserve document-node, link-protocol, image-type, and asset-path allowlists. HTML export must escape user text.
- The current library and backups are not encrypted. Do not describe local storage or a future UI lock as content encryption.

## Scope and Documentation

- Keep the local-first scope and existing warm-white/green, two-column interface unless the task changes them. Do not add cloud services, accounts, telemetry, or AI features implicitly.
- `docs/` is intentionally untracked and may be absent. When present, use `implementation-status.md` for known gaps and the product/design/architecture plans for intent, not proof of implementation.
- Read `README.md` for setup. Update it when commands or user-visible behavior change; update local implementation notes when relevant.
- Current backup files are assembled in memory and restore has a 512 MB limit; orphan cleanup, automatic data-process restart, and large-library performance are not established capabilities. Verify the affected implementation before making broader claims.

## Maintaining This File

- Add a rule when a user correction or repository-specific failure shows what would otherwise go wrong. Include the affected command, file, invariant, or consequence.
- Replace stale rules and merge duplicates. Keep routine setup in README and detailed plans in docs; do not turn this file into a feature inventory or work log.
- Retain expensive-to-rediscover process and data boundaries even when they can be inferred from code. Do not target an arbitrary line count.
- Instructions guide behavior; they are not enforced controls. Use tests or tooling for guarantees when implementing the relevant change, and never claim a hook or CI check exists until it does.
