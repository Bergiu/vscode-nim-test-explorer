import * as vscode from 'vscode';
import * as fs from 'fs';
import * as readline from 'readline';

export async function parseFileForTests(
    uri: vscode.Uri,
    controller: vscode.TestController,
    workspaceFolder: vscode.WorkspaceFolder | undefined
): Promise<vscode.TestItem[]> {
    const filePath = uri.fsPath;
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const items: vscode.TestItem[] = [];
    let currentSuiteItem: vscode.TestItem | undefined;
    let lineNumber = 0;

    // Matches `suite "Suite Name":` or `suite """Suite Name""":`
    const suiteRegex = /^\s*suite\s+"""([^"]+)"""\s*:|^\s*suite\s+"([^"]+)"\s*:/;
    // Matches `test "Test Name":` or `test """Test Name""":`
    const testRegex = /^\s*test\s+"""([^"]+)"""\s*:|^\s*test\s+"([^"]+)"\s*:/;

    for await (const line of rl) {
        const suiteMatch = line.match(suiteRegex);
        if (suiteMatch) {
            const suiteName = suiteMatch[1] ?? suiteMatch[2];
            const suiteId = `${uri.toString()}::${suiteName}`;
            const suiteItem = controller.createTestItem(suiteId, suiteName, uri);
            suiteItem.range = new vscode.Range(lineNumber, 0, lineNumber, line.length);
            currentSuiteItem = suiteItem;
            items.push(suiteItem);
        } else {
            const testMatch = line.match(testRegex);
            if (testMatch) {
                const testName = testMatch[1] ?? testMatch[2];
                const parentId = currentSuiteItem ? currentSuiteItem.id : uri.toString();
                const testId = `${parentId}::${testName}`;
                const testItem = controller.createTestItem(testId, testName, uri);
                testItem.range = new vscode.Range(lineNumber, 0, lineNumber, line.length);

                if (currentSuiteItem) {
                    currentSuiteItem.children.add(testItem);
                } else {
                    items.push(testItem);
                }
            }
        }
        lineNumber++;
    }

    return items;
}
