# Development Plan: Nim VS Code Test Controller

This document tracks the implementation progress of the VS Code Test Controller for Nim, using VS Code's **native Testing API** (`vscode.tests.createTestController`).

## 1. Project Scaffolding & Dependencies [x]

- TypeScript extension scaffolded with `yo code`
- `package.json` configured with `activationEvents`, `contributes.configuration`, and the `Testing` category
- No third-party test adapter libraries required (uses the VS Code built-in API)

## 2. Test Discovery [x]

**Approach:** Regex-based scanning of `.nim` files.

- Scans all `.nim` files matching `nimTestExplorer.testPath` (default: `tests/`)
- Detects `suite "..."` and `test "..."` (both `"` and `"""` string forms)
- Builds a `vscode.TestItem` tree: **file → suite → test**
- Maps line numbers for click-to-source navigation
- File watcher (`vscode.workspace.createFileSystemWatcher`) refreshes the tree on `.nim` file changes

## 3. Test Execution [x]

**Approach:** Spawn `nim c -r <file>` as a child process.

- Runs the selected test file(s) using Node's `child_process.spawn`
- Parses `unittest2` stdout for `[OK]`, `[FAILED]`, `[SKIPPED]` lines
- Reports results via `run.passed()`, `run.failed()`, `run.skipped()` on the `vscode.TestRun` object
- Supports cancellation via `CancellationToken` → `child.kill()`

## 4. Configuration Options [x]

Configurable via VS Code settings (`settings.json`):

| Setting | Default | Description |
|---|---|---|
| `nimTestExplorer.testPath` | `tests/` | Relative path to the tests directory |
| `nimTestExplorer.nimblePath` | `nimble` | Path to the nimble executable |
| `nimTestExplorer.compilerArgs` | _(empty)_ | Extra flags for the Nim compiler |

## 5. Future Improvements [ ]

- **Structured output:** [x] Use `unittest2`'s JUnit XML output (`--xml:<file>`) for reliable capture. Added fallback stdout parsing to support standard `unittest`.
- **Nimble integration:** [x] Support running `nimble c -r` instead of `nim c -r` directly, for projects with complex build setups.
- **Granular test filtering:** [x] Pass specific test names to the executable to avoid running unselected tests. Includes suite filtering and batch execution optimization.
- **Debug profile:** [x] Add a `vscode.TestRunProfileKind.Debug` run profile.
- **Continuous Testing:** [ ] Support VS Code's "Continuous Run" mode to auto-run tests on save.
- **Code Coverage:** [ ] Integrate with `nim-cov` (or similar) to show line coverage in the editor.
- **Rich Results & Diffs:** [ ] Add a diff view for failed assertions and ANSI color support in logs.
- **Parallel Execution:** [ ] Run test files in parallel to optimize execution time.
- **Custom Environment & Args:** [ ] Add settings for environment variables and direct test binary arguments.
- **Auto-cleanup:** [ ] Option to automatically delete temporary binaries and `nimcache` after runs.

## 6. Resources

- [VS Code Native Testing API Guide](https://code.visualstudio.com/api/extension-guides/testing)
- [Nim unittest2 GitHub Repository](https://github.com/status-im/nim-unittest2)
