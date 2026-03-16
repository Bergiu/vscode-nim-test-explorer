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
            (request, token) => this.runHandler(request, token, vscode.TestRunProfileKind.Run),
            true
        );

        this.controller.createRunProfile(
            'Debug',
            vscode.TestRunProfileKind.Debug,
            (request, token) => this.runHandler(request, token, vscode.TestRunProfileKind.Debug),
            false
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
        token: vscode.CancellationToken,
        profileKind: vscode.TestRunProfileKind
    ): Promise<void> {
        const run = this.controller.createTestRun(request);

        // Group items by workspace folder and then by URI/file
        const itemsByWs = new Map<vscode.WorkspaceFolder | undefined, Map<string, vscode.TestItem[]>>();

        const collectItemsToRun = (items: Iterable<vscode.TestItem>) => {
            for (const item of items) {
                if (token.isCancellationRequested) { break; }
                if (item.uri) {
                    const ws = vscode.workspace.getWorkspaceFolder(item.uri);
                    const uriStr = item.uri.toString();
                    if (!itemsByWs.has(ws)) { itemsByWs.set(ws, new Map()); }
                    const fileGroups = itemsByWs.get(ws)!;
                    if (!fileGroups.has(uriStr)) { fileGroups.set(uriStr, []); }
                    fileGroups.get(uriStr)!.push(item);
                }
            }
        };

        if (request.include) {
            collectItemsToRun(request.include);
        } else {
            // TestItemCollection is iterable but yields [id, TestItem] pairs
            for (const [id, item] of this.controller.items) {
                collectItemsToRun([item]);
            }
        }

        for (const [ws, fileGroups] of itemsByWs) {
            if (token.isCancellationRequested) { break; }
            for (const [uriStr, items] of fileGroups) {
                if (token.isCancellationRequested) { break; }
                // We pick the first item to get the common URI info, 
                // but implementation should ideally handle the list.
                // runNimTests will be updated to handle multiple items.
                await runNimTests(items, run, ws, token, profileKind);
            }
        }

        run.end();
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
