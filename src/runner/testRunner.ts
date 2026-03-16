import * as vscode from 'vscode';
import * as cp from 'child_process';

export async function runNimTests(
    fileItem: vscode.TestItem,
    run: vscode.TestRun,
    workspace: vscode.WorkspaceFolder | undefined,
    token: vscode.CancellationToken
): Promise<void> {
    if (!fileItem.uri) { return; }
    const filePath = fileItem.uri.fsPath;
    const cwd = workspace?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    const config = workspace
        ? vscode.workspace.getConfiguration('nimTestExplorer', workspace.uri)
        : vscode.workspace.getConfiguration('nimTestExplorer');
    const compilerArgsStr = config.get<string>('compilerArgs') ?? '';
    const compilerArgs = compilerArgsStr ? compilerArgsStr.split(' ') : [];

    // Build a map from test ID → TestItem for all children (suites + tests)
    const testMap = new Map<string, vscode.TestItem>();
    collectItems(fileItem, testMap);

    // Mark all as enqueued
    testMap.forEach(item => run.enqueued(item));
    run.enqueued(fileItem);

    return new Promise((resolve) => {
        const child = cp.spawn('nim', ['c', '-r', '--hints:off', ...compilerArgs, filePath], { cwd });

        let currentSuiteName = '';
        let outputBuffer = '';

        if (token.isCancellationRequested) {
            child.kill();
            resolve();
            return;
        }
        token.onCancellationRequested(() => child.kill());

        child.stdout.on('data', (data: Buffer) => {
            const text = data.toString();
            outputBuffer += text;
            run.appendOutput(text.replace(/\r?\n/g, '\r\n'));

            const lines = outputBuffer.split('\n');
            // Keep the last (potentially incomplete) line in the buffer
            outputBuffer = lines.pop() ?? '';

            for (const line of lines) {
                parseLine(line.trimEnd(), run, fileItem, testMap, currentSuiteName, (s) => { currentSuiteName = s; });
            }
        });

        child.stderr.on('data', (data: Buffer) => {
            const text = data.toString();
            run.appendOutput(text.replace(/\r?\n/g, '\r\n'));
        });

        child.on('close', (code) => {
            // Flush any remaining buffer
            if (outputBuffer) {
                parseLine(outputBuffer, run, fileItem, testMap, currentSuiteName, (s) => { currentSuiteName = s; });
            }

            if (code !== 0) {
                // If the process failed (e.g. compile error), mark all enqueued tests as errored
                testMap.forEach(item => {
                    if (run.token.isCancellationRequested) { return; }
                    run.errored(item, new vscode.TestMessage(`Process exited with code ${code}`));
                });
            }
            resolve();
        });

        child.on('error', (err) => {
            run.appendOutput(`\r\nFailed to start nim: ${err.message}\r\n`);
            resolve();
        });
    });
}

function collectItems(item: vscode.TestItem, map: Map<string, vscode.TestItem>): void {
    item.children.forEach(child => {
        map.set(child.id, child);
        collectItems(child, map);
    });
}

function parseLine(
    line: string,
    run: vscode.TestRun,
    fileItem: vscode.TestItem,
    testMap: Map<string, vscode.TestItem>,
    currentSuiteName: string,
    setSuite: (s: string) => void
): void {
    // "[OK      ] (  0.00s) Test A"
    const okMatch = line.match(/^\[OK\s*\][^(]*\(\s*[\d.]+s\)\s+(.+)$/);
    if (okMatch) {
        const testName = okMatch[1].trim();
        const item = findTestItem(testMap, fileItem, currentSuiteName, testName);
        if (item) { run.passed(item); }
        return;
    }

    // "[FAILED  ] (  0.00s) Test B"
    const failedMatch = line.match(/^\[FAILED\s*\][^(]*\(\s*[\d.]+s\)\s+(.+)$/);
    if (failedMatch) {
        const testName = failedMatch[1].trim();
        const item = findTestItem(testMap, fileItem, currentSuiteName, testName);
        if (item) {
            run.failed(item, new vscode.TestMessage(`Test "${testName}" failed`));
        }
        return;
    }

    // "[SKIPPED ] (  0.00s) Test C"
    const skipMatch = line.match(/^\[SKIPPED\s*\][^(]*\(\s*[\d.]+s\)\s+(.+)$/);
    if (skipMatch) {
        const testName = skipMatch[1].trim();
        const item = findTestItem(testMap, fileItem, currentSuiteName, testName);
        if (item) { run.skipped(item); }
        return;
    }

    // Suite header: "Suite MySuite" (Nim unittest2 output)
    const suiteMatch = line.match(/^Suite\s+(.+?)(?:\s*$)/);
    if (suiteMatch) {
        setSuite(suiteMatch[1].trim());
    }
}

function findTestItem(
    testMap: Map<string, vscode.TestItem>,
    fileItem: vscode.TestItem,
    suiteName: string,
    testName: string
): vscode.TestItem | undefined {
    // Try suite::test
    if (suiteName) {
        const suiteId = `${fileItem.id}::${suiteName}`;
        const testId = `${suiteId}::${testName}`;
        const found = testMap.get(testId);
        if (found) { return found; }
    }
    // Try file::test (no suite)
    return testMap.get(`${fileItem.id}::${testName}`);
}
