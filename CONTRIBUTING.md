# Contributing to EngineMonitor

Thanks for your interest! Bug reports, test results from other hardware and
pull requests are all welcome.

## Reporting bugs and hardware results

Open an issue with the **Bug report** template. Include:
- your OS and version, CPU and GPU,
- the EngineMonitor version (Settings → Application),
- what you expected and what you saw. For wrong values, include what another
  tool (Task Manager, `top`, Activity Monitor) shows at the same time.

Reports from **Linux and macOS** are especially useful: the app has not been
run there yet.

Security problems: please **don't** open a public issue. See
[SECURITY.md](SECURITY.md).

## Pull requests

1. For anything bigger than a small fix, open an issue first so we can agree
   on the approach.
2. Set up your environment as described in [DEVELOPMENT.md](DEVELOPMENT.md).
3. Keep changes focused; one topic per pull request.
4. Before you push, run:
   ```bash
   npm run typecheck && npm test && npm run build
   cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
   ```
   CI runs the same checks on Windows, Ubuntu and macOS.
5. Add or update tests for what you change, and update the docs it affects
   (README, ARCHITECTURE.md, DEVELOPMENT_STATUS.md).
6. In the pull request, say how you verified the change, including on which
   OS you ran the app.

## Ground rules for the code

These come from the project's design and are checked in review:

- **No invented data.** Never show placeholder, hardcoded or guessed metrics.
  If a value is unavailable or unsupported, the UI must say so.
- **Privacy.** The app makes no network requests and collects nothing it
  doesn't display. Don't add telemetry, update checks or remote resources.
- **Minimal permissions.** No new Tauri plugins or capabilities without a
  clear need explained in the pull request. Validate all input in Rust.
- **No administrator rights** for any feature.
- **Performance.** Measure changes that touch the sampler or rendering (see
  DEVELOPMENT.md → Performance).
- **Dependencies.** Prefer a few lines of code over a new dependency.
- `unsafe` Rust is limited to the Windows API modules and needs a `SAFETY:`
  comment for every block.

## Conduct

Be respectful and constructive. Harassment or personal attacks aren't
tolerated in issues, pull requests or discussions; maintainers may remove such
content and block the people responsible.

## License

By contributing, you agree that your contribution is licensed under the
project's [MIT License](LICENSE).
