import * as vscode from 'vscode';
import { parseFileForTests } from './parser/testParser';
import { runNimTests } from './runner/testRunner';

export class NimTestController implements vscode.Disposable {
    private readonly controller: vscode.TestController;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly context: vscode.ExtensionContext) {
        this.controller = vscode.tests.createTestController(
            'nimTestController',
            'Nim Tests'
        );
        this.disposables.push(this.controller);

        // Called when the user expands a node or opens the test explorer
        this.controller.resolveHandler = async (item) => {
            if (!item) {
                // Top-level: discover all test files
                await this.discoverAllTests();
            }
        };

        // Run profile
        this.controller.createRunProfile(
            'Run',
            vscode.TestRunProfileKind.Run,
            (request, token) => this.runHandler(request, token),
            true
        );

        // Watch for nim file changes
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.nim');
        watcher.onDidCreate(uri => this.refreshFile(uri));
        watcher.onDidChange(uri => this.refreshFile(uri));
        watcher.onDidDelete(uri => this.deleteFile(uri));
        this.disposables.push(watcher);

        // Initial discovery
        this.discoverAllTests();
    }

    private async discoverAllTests(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) { return; }

        for (const folder of workspaceFolders) {
            const config = vscode.workspace.getConfiguration('nimTestExplorer', folder.uri);
            const testPath = config.get<string>('testPath') || 'tests/';
            const pattern = new vscode.RelativePattern(folder, `${testPath}**/*.nim`);
            const files = await vscode.workspace.findFiles(pattern);
            for (const file of files) {
                await this.refreshFile(file);
            }
        }
    }

    private async refreshFile(uri: vscode.Uri): Promise<void> {
        // Remove stale item for this file first
        const existingId = uri.toString();
        this.controller.items.delete(existingId);

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        const fileItem = this.controller.createTestItem(
            existingId,
            vscode.workspace.asRelativePath(uri, false),
            uri
        );
        fileItem.canResolveChildren = true;

        const children = await parseFileForTests(uri, this.controller, workspaceFolder);
        if (children.length === 0) { return; } // skip files with no tests

        children.forEach(child => fileItem.children.add(child));
        this.controller.items.add(fileItem);
    }

    private deleteFile(uri: vscode.Uri): void {
        this.controller.items.delete(uri.toString());
    }

    private async runHandler(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken
    ): Promise<void> {
        const run = this.controller.createTestRun(request);

        // Collect all test items to run
        const itemsToRun: vscode.TestItem[] = [];
        if (request.include) {
            request.include.forEach(item => itemsToRun.push(item));
        } else {
            this.controller.items.forEach(item => itemsToRun.push(item));
        }

        for (const item of itemsToRun) {
            if (token.isCancellationRequested) { break; }

            // If it's a file-level item, run all tests in that file
            if (item.uri) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(item.uri);
                await runNimTests(item, run, workspaceFolder, token);
            }
        }

        run.end();
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
