import * as vscode from 'vscode';

export function collectItems(item: vscode.TestItem, map: Map<string, vscode.TestItem>): void {
    map.set(item.id, item);
    item.children.forEach(child => {
        collectItems(child, map);
    });
}

export function findTestItem(
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
