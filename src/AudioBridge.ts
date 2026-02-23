import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

type BridgeMessage = Record<string, unknown>;

export class AudioBridge implements vscode.Disposable {
  private panel: vscode.WebviewPanel;
  private _emitter = new EventEmitter();
  readonly onMessage: EventEmitter = this._emitter;
  private _disposed = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.panel = this.createPanel();
  }

  private createPanel(): vscode.WebviewPanel {
    const webviewDir = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');

    const panel = vscode.window.createWebviewPanel(
      'ccSpeakerBridge',
      'CC Speaker Bridge',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewDir],
      }
    );

    panel.webview.html = this.getWebviewContent(panel.webview, webviewDir);

    panel.webview.onDidReceiveMessage(
      (msg: BridgeMessage) => this._emitter.emit('message', msg),
      undefined,
      this.context.subscriptions
    );

    // Recreate panel if user closes it
    panel.onDidDispose(() => {
      if (!this._disposed) {
        this.panel = this.createPanel();
      }
    }, null, this.context.subscriptions);

    return panel;
  }

  send(message: BridgeMessage): void {
    this.panel.webview.postMessage(message);
  }

  private getWebviewContent(webview: vscode.Webview, webviewDir: vscode.Uri): string {
    const htmlPath = path.join(webviewDir.fsPath, 'bridge.html');
    const nonce = getNonce();
    const cspSource = webview.cspSource;
    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(webviewDir, 'bridge.js'))
      .toString();

    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace(/\{\{nonce\}\}/g, nonce);
    html = html.replace(/\{\{cspSource\}\}/g, cspSource);
    html = html.replace(/\{\{scriptUri\}\}/g, scriptUri);
    return html;
  }

  dispose(): void {
    this._disposed = true;
    this.panel.dispose();
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
