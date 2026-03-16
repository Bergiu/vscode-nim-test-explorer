import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { collectItems } from './testItemUtils';
import { parseXmlResults, parseStdoutResults } from './resultsParser';

export async function runNimTests(
    items: vscode.TestItem[],
    run: vscode.TestRun,
    workspace: vscode.WorkspaceFolder | undefined,
    token: vscode.CancellationToken,
    profileKind: vscode.TestRunProfileKind = vscode.TestRunProfileKind.Run
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
    const isDebug = profileKind === vscode.TestRunProfileKind.Debug;
    const debuggerType = config.get<string>('debuggerType') ?? 'cppdbg';
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
    
    // Detect if we are using unittest or unittest2
    let isUnittest2 = true;
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        isUnittest2 = content.includes('import unittest2');
    } catch (e) {
        run.appendOutput(`[Extension Warning] Failed to read file for library detection: ${e}\r\n`);
    }

    const filteredFilters = isUnittest2 ? filters : filters.map(f => f.replace(/.*::/, ''));

    run.appendOutput(`[Extension Debug] Library: ${isUnittest2 ? 'unittest2' : 'unittest'}\r\n`);
    run.appendOutput(`[Extension Debug] Filters: ${filteredFilters.join(', ') || '(none - running all)'}\r\n`);
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

        if (isDebug) {
            commonFlags.push('--debuginfo', '-g', '--lineDir:on');
        }

        const runnerFlags = isUnittest2 
            ? ['--output-level=VERBOSE', `--xml:${xmlPath}`, ...filteredFilters]
            : [...filteredFilters];

        let hasSeenAnyResult = false;

        const cleanup = () => {
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch (e) {
                console.error(`Failed to clean up temp dir ${tmpDir}:`, e);
            }
        };

        const runBinary = async () => {
            if (token.isCancellationRequested) {
                cleanup();
                resolve();
                return;
            }

            if (isDebug) {
                run.appendOutput(`[Extension Debug] Starting debug session for: ${binPath}\r\n`);
                
                const debugConfiguration: vscode.DebugConfiguration = {
                    name: `Nim Test: ${binName}`,
                    type: debuggerType,
                    request: 'launch',
                    program: binPath,
                    args: runnerFlags,
                    cwd: cwd,
                    console: 'internalConsole',
                    stopAtEntry: false,
                };

                const sessionStarted = await vscode.debug.startDebugging(workspace, debugConfiguration);
                if (!sessionStarted) {
                    run.appendOutput(`\r\n[Extension Error] Failed to start debug session.\r\n`);
                    testMap.forEach(item => {
                        run.errored(item, new vscode.TestMessage(`Failed to start debug session.`));
                    });
                    cleanup();
                    resolve();
                    return;
                }

                // Wait for the session to terminate
                const disposable = vscode.debug.onDidTerminateDebugSession((session) => {
                    if (session.name === debugConfiguration.name) {
                        disposable.dispose();
                        finishRun(0); // We assume code 0 if it finished normally
                    }
                });

                token.onCancellationRequested(() => {
                    // Logic to find and stop the specific debug session could be added here
                    // but onDidTerminateDebugSession will handle the cleanup.
                });

            } else {
                run.appendOutput(`[Extension Debug] Executing binary: ${binPath} ${runnerFlags.join(' ')}\r\n`);
                
                const child = cp.spawn(binPath, runnerFlags, { cwd });

                token.onCancellationRequested(() => child.kill());

                child.stdout.on('data', (data: Buffer) => {
                    const text = data.toString();
                    run.appendOutput(text.replace(/\r?\n/g, '\r\n'));
                    stdoutBuffer += text;
                });

                child.stderr.on('data', (data: Buffer) => {
                    run.appendOutput(data.toString().replace(/\r?\n/g, '\r\n'));
                });

                child.on('close', (code) => {
                    finishRun(code);
                });

                child.on('error', (err) => {
                    run.appendOutput(`\r\nFailed to start test binary: ${err.message}\r\n`);
                    cleanup();
                    resolve();
                });
            }
        };

        let stdoutBuffer = '';

        const finishRun = (code: number | null) => {
            let resultsFound = false;
            if (fs.existsSync(xmlPath)) {
                try {
                    const xmlContent = fs.readFileSync(xmlPath, 'utf8');
                    if (parseXmlResults(xmlContent, run, firstItem, testMap)) {
                        resultsFound = true;
                        hasSeenAnyResult = true;
                    }
                } catch (err) {
                    run.appendOutput(`\r\n[Extension Error] Failed to parse XML results: ${err}\r\n`);
                }
            }

            if (!resultsFound && stdoutBuffer) {
                run.appendOutput(`\r\n[Extension Debug] XML results not found or empty. Falling back to stdout parsing...\r\n`);
                if (parseStdoutResults(stdoutBuffer, run, firstItem, testMap)) {
                    hasSeenAnyResult = true;
                }
            }

            if (code !== 0 && !hasSeenAnyResult && !token.isCancellationRequested) {
                testMap.forEach(item => {
                    run.errored(item, new vscode.TestMessage(`Process exited with code ${code}. Check output for errors.`));
                });
            }

            cleanup();
            resolve();
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
            const args = ['c', ...commonFlags, filePath];
            // If not debugging, we can use -r to run it immediately.
            // If debugging, we must compile first, THEN start debugging the binary.
            if (!isDebug) {
                args.splice(1, 0, '-r');
                args.push(...runnerFlags);
            }

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
                const text = data.toString();
                run.appendOutput(text.replace(/\r?\n/g, '\r\n'));
                stdoutBuffer += text;
            });

            child.stderr.on('data', (data: Buffer) => {
                run.appendOutput(data.toString().replace(/\r?\n/g, '\r\n'));
            });

            child.on('close', (code) => {
                if (code === 0 && isDebug) {
                    runBinary();
                } else {
                    finishRun(code);
                }
            });

            child.on('error', (err) => {
                run.appendOutput(`\r\nFailed to start nim: ${err.message}\r\n`);
                cleanup();
                resolve();
            });
        }
    });
}


