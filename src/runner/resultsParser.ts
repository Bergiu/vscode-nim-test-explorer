import * as vscode from 'vscode';
import { XMLParser } from 'fast-xml-parser';
import { findTestItem } from './testItemUtils';

export function parseXmlResults(
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

export function parseStdoutResults(
    stdout: string,
    run: vscode.TestRun,
    itemToRun: vscode.TestItem,
    testMap: Map<string, vscode.TestItem>
): boolean {
    const fileUri = itemToRun.uri!.toString();
    const lines = stdout.split(/\r?\n/);
    let currentSuiteName = '';
    let hasResults = false;
    let pendingFailureMessage = '';

    for (const line of lines) {
        const trimmed = line.trim();
        
        // Suite: [Suite] Name
        const suiteMatch = trimmed.match(/^\[Suite\]\s+(.+)$/);
        if (suiteMatch) {
            currentSuiteName = suiteMatch[1].trim();
            continue;
        }

        // Passed: [OK] Name
        const okMatch = trimmed.match(/^\[OK\]\s+(.+)$/);
        if (okMatch) {
            const testName = okMatch[1].trim();
            const item = findTestItem(testMap, fileUri, currentSuiteName, testName, run);
            if (item) {
                run.passed(item);
                hasResults = true;
            }
            pendingFailureMessage = '';
            continue;
        }

        // Failed: [FAILED] Name
        const failedMatch = trimmed.match(/^\[FAILED\]\s+(.+)$/);
        if (failedMatch) {
            const testName = failedMatch[1].trim();
            const item = findTestItem(testMap, fileUri, currentSuiteName, testName, run);
            if (item) {
                run.failed(item, new vscode.TestMessage(pendingFailureMessage || 'Test failed'));
                hasResults = true;
            }
            pendingFailureMessage = '';
            continue;
        }

        // Skipped: [SKIPPED] Name
        const skippedMatch = trimmed.match(/^\[SKIPPED\]\s+(.+)$/);
        if (skippedMatch) {
            const testName = skippedMatch[1].trim();
            const item = findTestItem(testMap, fileUri, currentSuiteName, testName, run);
            if (item) {
                run.skipped(item);
                hasResults = true;
            }
            pendingFailureMessage = '';
            continue;
        }

        // Collect failure details (not starting with [)
        if (trimmed && !trimmed.startsWith('[')) {
            pendingFailureMessage += (pendingFailureMessage ? '\n' : '') + trimmed;
        }
    }

    return hasResults;
}
