import * as vscode from 'vscode';
import { NimTestController } from './nimTestAdapter';

export function activate(context: vscode.ExtensionContext) {
    const controller = new NimTestController(context);
    context.subscriptions.push(controller);
}

export function deactivate() {}
