import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';

export async function runNimTests(
    itemToRun: vscode.TestItem,
    run: vscode.TestRun,
    workspace: vscode.WorkspaceFolder | undefined,
    token: vscode.CancellationToken
): Promise<void> {
    if (!itemToRun.uri) { return; }
    const fileUri = itemToRun.uri.toString();
    const filePath = itemToRun.uri.fsPath;
    const cwd = workspace?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    const config = workspace
        ? vscode.workspace.getConfiguration('nimTestExplorer', workspace.uri)
        : vscode.workspace.getConfiguration('nimTestExplorer');
    const compilerArgsStr = config.get<string>('compilerArgs') ?? '';
    const compilerArgs = compilerArgsStr ? compilerArgsStr.split(' ') : [];

    // Build a map from test ID → TestItem for all descendants
    const testMap = new Map<string, vscode.TestItem>();
    collectItems(itemToRun, testMap);

    run.appendOutput(`\r\n[Extension Debug] Map contains ${testMap.size} items:\n`);
    for (const [id, item] of testMap.entries()) {
        run.appendOutput(`  - ID: "${id}", Label: "${item.label}"\n`);
    }

    // Mark all as enqueued
    testMap.forEach(item => run.enqueued(item));

    // Determine filter (if we're running a specific test or suite)
    const filter = itemToRun.id === fileUri 
        ? '' 
        : itemToRun.id.substring(fileUri.length + 2); // Skip the '::'

    run.appendOutput(`\r\n[Extension Debug] Running: ${itemToRun.id}\r\n`);
    run.appendOutput(`[Extension Debug] Filter: ${filter || '(none)'}\r\n`);

    return new Promise((resolve) => {
        // Create a temporary directory for the test binary and nimcache
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-tests-'));
        const xmlPath = path.join(tmpDir, 'results.xml');
        
        const args = [
            'c', 
            '-r', 
            '--hints:off', 
            `--outdir:${tmpDir}`, 
            `--nimcache:${path.join(tmpDir, 'nimcache')}`,
            ...compilerArgs, 
            filePath, 
            '--output-level=VERBOSE',
            `--xml:${xmlPath}`
        ];
        if (filter) {
            args.push(filter);
        }
        const child = cp.spawn('nim', args, { cwd });

        let hasSeenAnyResult = false;

        if (token.isCancellationRequested) {
            child.kill();
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
            resolve();
            return;
        }
        token.onCancellationRequested(() => child.kill());

        child.stdout.on('data', (data: Buffer) => {
            const text = data.toString();
            run.appendOutput(text.replace(/\r?\n/g, '\r\n'));
        });

        child.stderr.on('data', (data: Buffer) => {
            const text = data.toString();
            run.appendOutput(text.replace(/\r?\n/g, '\r\n'));
        });

        child.on('close', (code) => {
            // Check if XML exists and parse it
            if (fs.existsSync(xmlPath)) {
                try {
                    const xmlContent = fs.readFileSync(xmlPath, 'utf8');
                    if (parseXmlResults(xmlContent, run, itemToRun, testMap)) {
                        hasSeenAnyResult = true;
                    }
                } catch (err) {
                    run.appendOutput(`\r\n[Extension Error] Failed to parse XML results: ${err}\r\n`);
                }
            }

            // Only mark as errored if we didn't see any test results (e.g. compile error)
            // and the process exited with a non-zero code.
            if (code !== 0 && !hasSeenAnyResult && !token.isCancellationRequested) {
                testMap.forEach(item => {
                    run.errored(item, new vscode.TestMessage(`Process exited with code ${code}. Check output for compilation errors.`));
                });
            }

            // Clean up temporary directory
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch (e) {
                console.error(`Failed to clean up temp dir ${tmpDir}:`, e);
            }
            resolve();
        });

        child.on('error', (err) => {
            run.appendOutput(`\r\nFailed to start nim: ${err.message}\r\n`);
            // Clean up temporary directory
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch (e) {
                // Ignore if it doesn't exist yet
            }
            resolve();
        });
    });
}

function parseXmlResults(
    xmlContent: string,
    run: vscode.TestRun,
    itemToRun: vscode.TestItem,
    testMap: Map<string, vscode.TestItem>
): boolean {
    const fileUri = itemToRun.uri!.toString();
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
        parseAttributeValue: true
    });

    const jsonObj = parser.parse(xmlContent);
    if (!jsonObj) { return false; }

    let hasResults = false;

    // The root could be <testsuites> or <testsuite>
    const suitesData = jsonObj.testsuites?.testsuite ?? jsonObj.testsuite;
    if (!suitesData) { return false; }

    // Normalize to array
    const suites = Array.isArray(suitesData) ? suitesData : [suitesData];

    for (const suite of suites) {
        const suiteName = suite.name || '';
        const casesData = suite.testcase;
        if (!casesData) { continue; }

        const cases = Array.isArray(casesData) ? casesData : [casesData];

        for (const testCase of cases) {
            const testName = testCase.name;
            if (!testName) { continue; }

            const item = findTestItem(testMap, fileUri, suiteName, testName, run);
            if (item) {
                hasResults = true;
                if (testCase.failure) {
                    const message = testCase.failure.message || 'Test failed';
                    const details = typeof testCase.failure === 'string' ? testCase.failure : (testCase.failure['#text'] || '');
                    run.failed(item, new vscode.TestMessage(`${message}\n\n${details}`));
                } else if (testCase.skipped !== undefined) {
                    run.skipped(item);
                } else {
                    run.passed(item);
                }
            }
        }
    }

    return hasResults;
}

function collectItems(item: vscode.TestItem, map: Map<string, vscode.TestItem>): void {
    map.set(item.id, item);
    item.children.forEach(child => {
        collectItems(child, map);
    });
}


function findTestItem(
    testMap: Map<string, vscode.TestItem>,
    fileUri: string,
    suiteName: string,
    testName: string,
    run: vscode.TestRun
): vscode.TestItem | undefined {
    run.appendOutput(`[Extension Debug] Searching for test: "${testName}" in suite: "${suiteName || '(none)'}"\n`);

    for (const item of testMap.values()) {
        // Match test label
        if (item.label === testName) {
            // If we have a suite name, the parent MUST match the suite label
            if (suiteName) {
                if (item.parent && item.parent.label === suiteName) {
                    return item;
                }
            } else {
                // If no suite name, the parent should be the file (or have no parent in the map)
                // In our parser, tests without a suite are directly under the file item.
                if (!item.parent || item.parent.id === fileUri) {
                    return item;
                }
            }
        }
    }

    // Fallback: If we still haven't found it, try matching just the label if it's unique
    const labelMatches = Array.from(testMap.values()).filter(i => i.label === testName);
    if (labelMatches.length === 1) {
        return labelMatches[0];
    }

    return undefined;
}
