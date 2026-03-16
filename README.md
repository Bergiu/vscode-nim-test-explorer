# Nim VS Code Test Controller

A VS Code extension that integrates Nim's testing ecosystem with VS Code's **native Testing API** (`vscode.tests.createTestController`). It supports projects using the [`unittest2`](https://github.com/status-im/nim-unittest2) (and standard `unittest`) library, providing automatic test discovery, execution, and result reporting directly in the VS Code Test Explorer (the beaker icon).

## Features

1. **Test Discovery**: Automatically scans `.nim` files in the configured test directory for `suite` and `test` blocks.
2. **Test Execution**: Runs individual tests, suites, or all tests using `nim c -r`.
3. **Result Parsing**: Uses the `fast-xml-parser` library to read JUnit XML results from `unittest2`. It also includes a robust **fallback stdout parser** for the standard `unittest` library, ensuring results are captured even when XML output is unavailable.
4. **Granular Filtering**: Run individual tests or entire suites with correct globbing (e.g., `SuiteName::*`).
5. **Performance Batching**: Multiple test selections in the same file are batched into a single process execution to minimize compilation and runtime overhead.
6. **Integrated Debugging**: Debug your tests directly from the Testing view with standard VS Code debuggers (GDB/LLDB).
7. **File Watching**: Automatically refreshes the test tree when `.nim` files change.

## Getting Started (Development)

### Prerequisites
- Node.js and npm
- VS Code
- Nim compiler in your `PATH`

### Running Locally

1. **Open the Project:** Open this repository folder in VS Code.
2. **Install Dependencies:** `npm install`
3. **Start the Compiler:** `npm run watch` (keeps TypeScript compiled in the background)
4. **Launch the Extension:** Press `F5` — a new **Extension Development Host** window opens automatically with the `example/` folder loaded.
5. **Test the Adapter:** In the new window, click the **Testing** (beaker) icon in the Activity Bar. You should see the discovered Nim tests from `example/tests/`.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `nimTestExplorer.testPath` | `tests/` | Relative path to the tests directory |
| `nimTestExplorer.useNimble` | `false` | Use `nimble c -r` instead of `nim c -r` to run tests. |
| `nimTestExplorer.nimblePath` | `nimble` | Path to the `nimble` executable |
| `nimTestExplorer.compilerArgs` | _(empty)_ | Extra flags to pass to the Nim compiler |
| `nimTestExplorer.debuggerType` | `cppdbg` | The debugger type for the Debug profile (e.g. `cppdbg` or `lldb`). |

## Architecture

This extension uses VS Code's native Testing API:

- **`src/main.ts`** — `activate()` creates the `NimTestController` and subscribes it to the extension context.
- **`src/nimTestAdapter.ts`** — Core controller. Creates a `vscode.TestController`, discovers tests via the parser, watches for file changes, and runs tests via the runner.
- **`src/parser/testParser.ts`** — Scans `.nim` files with regex for `suite` and `test` declarations, returning `vscode.TestItem` objects.
- **`src/runner/testRunner.ts`** — Spawns `nim c -r`. It detects whether the test file uses `unittest` or `unittest2` to provide the correct flags. It parses JUnit XML (from `unittest2`) or falls back to a regex-based stdout parser (for standard `unittest`). Also handles the **Debug profile** by compiling with symbols and launching a VS Code debug session.

## Installing Locally (as a `.vsix` package)

This is how to build and install the extension as a real VS Code extension (not just in the development host).

1. **Build the production bundle:**
   ```bash
   npm run compile
   ```

2. **Package the extension:**
   ```bash
   npx @vscode/vsce package
   ```
   This creates a `.vsix` file (e.g. `nim-test-explorer-0.3.0.vsix`) in the project root.

4. **Install the `.vsix` in VS Code:**
   - Open VS Code.
   - Open the Command Palette (`Ctrl+Shift+P`) and run **"Extensions: Install from VSIX..."**.
   - Select the generated `.vsix` file.
   - Reload VS Code when prompted.

   Or from the terminal:
   ```bash
   code --install-extension nim-test-explorer-0.3.0.vsix
   ```

## Publishing to the VS Code Marketplace

> [!IMPORTANT]
> You need a free [Azure DevOps](https://dev.azure.com/) account and a Personal Access Token (PAT) to publish.

1. **Create a publisher** on the [VS Code Marketplace management page](https://marketplace.visualstudio.com/manage) (one-time setup).

2. **Add publisher info to `package.json`:**
   ```json
   "publisher": "your-publisher-id"
   ```

3. **Log in with `vsce`:**
   ```bash
   npx @vscode/vsce login your-publisher-id
   ```
   Paste your PAT when prompted.

4. **Publish:**
   ```bash
   npx @vscode/vsce publish
   ```
   Or publish a specific version bump (e.g. patch):
   ```bash
   npx @vscode/vsce publish patch
   ```

5. The extension is live at `https://marketplace.visualstudio.com/items?itemName=your-publisher-id.nim-test-explorer` within a few minutes.

> [!NOTE]
> This extension depends on the **C/C++ (ms-vscode.cpptools)** extension for its debugging features. It will be automatically installed when you install this extension.

## License

MIT
