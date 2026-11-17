## What and why

## How I verified it
<!-- Tests added or run, and on which OS you ran the app. -->

## Checklist
- [ ] `npm run typecheck && npm test && npm run build`
- [ ] `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` (in `src-tauri/`)
- [ ] Docs updated (README / ARCHITECTURE.md / DEVELOPMENT_STATUS.md) where needed
- [ ] No invented metrics, no new network access, no new permissions without explanation
