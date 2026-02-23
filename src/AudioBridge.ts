import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

type BridgeMessage = Record<string, unknown>;

export class AudioBridge implements vscode.WebviewViewProvider, vscode.Disposable {
  private _view?: vscode.WebviewView;
  private _emitter = new EventEmitter();
  readonly onMessage: EventEmitter = this._emitter;
  private _pendingMessages: BridgeMessage[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('ccSpeakerBridge', this, {
        webviewOptions: { retainContextWhenHidden: true },
      })
    );
  }

  // Called by VS Code when the sidebar view becomes visible for the first time
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    const webviewDir = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [webviewDir],
    };

    webviewView.webview.html = this.getWebviewContent(webviewView.webview, webviewDir);

    webviewView.webview.onDidReceiveMessage(
      (msg: BridgeMessage) => this._emitter.emit('message', msg),
      undefined,
      this.context.subscriptions
    );

    webviewView.onDidDispose(() => {
      this._view = undefined;
    }, null, this.context.subscriptions);

    // Flush messages queued before the view was ready
    for (const msg of this._pendingMessages) {
      void webviewView.webview.postMessage(msg);
    }
    this._pendingMessages = [];
  }

  send(message: BridgeMessage): void {
    if (this._view) {
      void this._view.webview.postMessage(message);
    } else {
      // View not yet resolved — queue for when it initialises
      this._pendingMessages.push(message);
    }
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
    // Subscriptions registered on context are cleaned up automatically
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
