# Nim VS Code Test Controller

A VS Code extension that integrates Nim's testing ecosystem with VS Code's **native Testing API** (`vscode.tests.createTestController`). It supports projects using the [`unittest2`](https://github.com/status-im/nim-unittest2) (and standard `unittest`) library, providing automatic test discovery, execution, and result reporting directly in the VS Code Test Explorer (the beaker icon).

## Features

1. **Test Discovery**: Automatically scans `.nim` files in the configured test directory for `suite` and `test` blocks.
2. **Test Execution**: Runs individual tests, suites, or all tests using `nim c -r`.
3. **Result Parsing**: Uses the `fast-xml-parser` library to read JUnit XML results from `unittest2`, providing robust reporting for `passed`, `failed`, and `skipped` states.
4. **File Watching**: Automatically refreshes the test tree when `.nim` files change.

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
| `nimTestExplorer.nimblePath` | `nimble` | Path to the `nimble` executable |
| `nimTestExplorer.compilerArgs` | _(empty)_ | Extra flags to pass to the Nim compiler |

## Architecture

This extension uses VS Code's native Testing API:

- **`src/main.ts`** — `activate()` creates the `NimTestController` and subscribes it to the extension context.
- **`src/nimTestAdapter.ts`** — Core controller. Creates a `vscode.TestController`, discovers tests via the parser, watches for file changes, and runs tests via the runner.
- **`src/parser/testParser.ts`** — Scans `.nim` files with regex for `suite` and `test` declarations, returning `vscode.TestItem` objects.
- **`src/runner/testRunner.ts`** — Spawns `nim c -r` with the `--xml` flag and parses the resulting JUnit XML using `fast-xml-parser` to report results via `vscode.TestRun`.

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
   This creates a `.vsix` file (e.g. `nim-test-explorer-0.1.0.vsix`) in the project root.

4. **Install the `.vsix` in VS Code:**
   - Open VS Code.
   - Open the Command Palette (`Ctrl+Shift+P`) and run **"Extensions: Install from VSIX..."**.
   - Select the generated `.vsix` file.
   - Reload VS Code when prompted.

   Or from the terminal:
   ```bash
   code --install-extension nim-test-explorer-0.1.0.vsix
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

## License

MIT
