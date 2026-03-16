import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';

export async function runNimTests(
    items: vscode.TestItem[],
    run: vscode.TestRun,
    workspace: vscode.WorkspaceFolder | undefined,
    token: vscode.CancellationToken
): Promise<void> {
    if (items.length === 0) { return; }
    
    // All items should be from the same file
    const firstItem = items[0];
    if (!firstItem.uri) { return; }
    
    const fileUri = firstItem.uri.toString();
    const filePath = firstItem.uri.fsPath;
    const cwd = workspace?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    const config = workspace
        ? vscode.workspace.getConfiguration('nimTestExplorer', workspace.uri)
        : vscode.workspace.getConfiguration('nimTestExplorer');
    const useNimble = config.get<boolean>('useNimble') ?? false;
    const nimblePath = config.get<string>('nimblePath') ?? 'nimble';
    const compilerArgsStr = config.get<string>('compilerArgs') ?? '';
    const compilerArgs = compilerArgsStr ? compilerArgsStr.split(' ') : [];

    // Build a map from test ID → TestItem for all descendants of all selected items
    const testMap = new Map<string, vscode.TestItem>();
    items.forEach(item => collectItems(item, testMap));

    run.appendOutput(`\r\n[Extension Debug] Map contains ${testMap.size} items:\n`);
    for (const [id, item] of testMap.entries()) {
        run.appendOutput(`  - ID: "${id}", Label: "${item.label}"\n`);
    }

    // Mark all as enqueued
    testMap.forEach(item => run.enqueued(item));

    // Determine filters
    const filters: string[] = [];
    const runAllInFile = items.some(item => item.id === fileUri);

    if (!runAllInFile) {
        for (const item of items) {
            let filter = item.id.substring(fileUri.length + 2); // Skip the '::'
            // If it's a suite, append '::*' to run all tests within it
            if (item.children.size > 0) {
                filter += '::*';
            }
            filters.push(filter);
        }
    }

    run.appendOutput(`\r\n[Extension Debug] Running file: ${fileUri}\r\n`);
    run.appendOutput(`[Extension Debug] Filters: ${filters.join(', ') || '(none - running all)'}\r\n`);
    run.appendOutput(`[Extension Debug] Using Nimble: ${useNimble}\r\n`);

    return new Promise((resolve) => {
        // Create a temporary directory for the test binary and nimcache
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-tests-'));
        const xmlPath = path.join(tmpDir, 'results.xml');
        const binName = path.basename(filePath, '.nim');
        const binPath = path.join(tmpDir, binName);
        
        const commonFlags = [
            '--hints:off', 
            `--outdir:${tmpDir}`, 
            `--nimcache:${path.join(tmpDir, 'nimcache')}`,
            ...compilerArgs
        ];

        const runnerFlags = [
            '--output-level=VERBOSE',
            `--xml:${xmlPath}`,
            ...filters
        ];

        let hasSeenAnyResult = false;

        const cleanup = () => {
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch (e) {
                console.error(`Failed to clean up temp dir ${tmpDir}:`, e);
            }
        };

        const runBinary = () => {
            if (token.isCancellationRequested) {
                cleanup();
                resolve();
                return;
            }

            run.appendOutput(`[Extension Debug] Executing binary: ${binPath} ${runnerFlags.join(' ')}\r\n`);
            
            const child = cp.spawn(binPath, runnerFlags, { cwd });

            token.onCancellationRequested(() => child.kill());

            child.stdout.on('data', (data: Buffer) => {
                run.appendOutput(data.toString().replace(/\r?\n/g, '\r\n'));
            });

            child.stderr.on('data', (data: Buffer) => {
                run.appendOutput(data.toString().replace(/\r?\n/g, '\r\n'));
            });

            child.on('close', (code) => {
                if (fs.existsSync(xmlPath)) {
                    try {
                        const xmlContent = fs.readFileSync(xmlPath, 'utf8');
                        if (parseXmlResults(xmlContent, run, firstItem, testMap)) {
                            hasSeenAnyResult = true;
                        }
                    } catch (err) {
                        run.appendOutput(`\r\n[Extension Error] Failed to parse XML results: ${err}\r\n`);
                    }
                }

                if (code !== 0 && !hasSeenAnyResult && !token.isCancellationRequested) {
                    testMap.forEach(item => {
                        run.errored(item, new vscode.TestMessage(`Process exited with code ${code}. Check output for errors.`));
                    });
                }

                cleanup();
                resolve();
            });

            child.on('error', (err) => {
                run.appendOutput(`\r\nFailed to start test binary: ${err.message}\r\n`);
                cleanup();
                resolve();
            });
        };

        if (useNimble) {
            const compileArgs = ['c', ...commonFlags, filePath];
            run.appendOutput(`[Extension Debug] Compiling with Nimble: ${nimblePath} ${compileArgs.join(' ')}\r\n`);
            
            const compileProcess = cp.spawn(nimblePath, compileArgs, { cwd });
            
            token.onCancellationRequested(() => compileProcess.kill());

            compileProcess.stdout.on('data', (data: Buffer) => {
                run.appendOutput(data.toString().replace(/\r?\n/g, '\r\n'));
            });

            compileProcess.stderr.on('data', (data: Buffer) => {
                run.appendOutput(data.toString().replace(/\r?\n/g, '\r\n'));
            });

            compileProcess.on('close', (code) => {
                if (code === 0) {
                    runBinary();
                } else {
                    run.appendOutput(`\r\n[Extension Error] Compilation failed with code ${code}\r\n`);
                    testMap.forEach(item => {
                        run.errored(item, new vscode.TestMessage(`Compilation failed with code ${code}.`));
                    });
                    cleanup();
                    resolve();
                }
            });

            compileProcess.on('error', (err) => {
                run.appendOutput(`\r\nFailed to start Nimble: ${err.message}\r\n`);
                cleanup();
                resolve();
            });
        } else {
            const args = ['c', '-r', ...commonFlags, filePath, ...runnerFlags];
            run.appendOutput(`[Extension Debug] Running with Nim: nim ${args.join(' ')}\r\n`);
            
            const child = cp.spawn('nim', args, { cwd });

            if (token.isCancellationRequested) {
                child.kill();
                cleanup();
                resolve();
                return;
            }
            token.onCancellationRequested(() => child.kill());

            child.stdout.on('data', (data: Buffer) => {
                run.appendOutput(data.toString().replace(/\r?\n/g, '\r\n'));
            });

            child.stderr.on('data', (data: Buffer) => {
                run.appendOutput(data.toString().replace(/\r?\n/g, '\r\n'));
            });

            child.on('close', (code) => {
                if (fs.existsSync(xmlPath)) {
                    try {
                        const xmlContent = fs.readFileSync(xmlPath, 'utf8');
                        if (parseXmlResults(xmlContent, run, firstItem, testMap)) {
                            hasSeenAnyResult = true;
                        }
                    } catch (err) {
                        run.appendOutput(`\r\n[Extension Error] Failed to parse XML results: ${err}\r\n`);
                    }
                }

                if (code !== 0 && !hasSeenAnyResult && !token.isCancellationRequested) {
                    testMap.forEach(item => {
                        run.errored(item, new vscode.TestMessage(`Process exited with code ${code}. Check output for compilation errors.`));
                    });
                }

                cleanup();
                resolve();
            });

            child.on('error', (err) => {
                run.appendOutput(`\r\nFailed to start nim: ${err.message}\r\n`);
                cleanup();
                resolve();
            });
        }
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
