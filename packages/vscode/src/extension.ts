import * as vscode from 'vscode';

export function activate(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('claudeFlow.new', () => {
      // M4: create untitled *.clauflow.json and open the custom editor webview
      vscode.window.showInformationMessage('Claude Flow: new workflow (TODO M4)');
    }),
  );
  // M4: register custom editor (clauflow.editor), tree view, import/export/run commands.
  // Webview loads the @clauflow/canvas bundle; HostBridge implemented over postMessage.
}

export function deactivate() {}
