import * as vscode from 'vscode';
import { AudioBridge } from './AudioBridge';

type StatusCallback = (icon: string, tooltip?: string) => void;
interface BridgeMsg { command: string; text?: string; isFinal?: boolean; message?: string; }

export class STTController implements vscode.Disposable {
  private isListening = false;
  private statusCallback: StatusCallback = () => { /* noop */ };

  constructor(
    private readonly bridge: AudioBridge,
    private readonly context: vscode.ExtensionContext
  ) {
    bridge.onMessage.on('message', (msg: BridgeMsg) => {
      switch (msg.command) {
        case 'transcript':
          if (msg.isFinal && msg.text) {
            void this.handleTranscript(msg.text);
          }
          break;
        case 'error':
          this.isListening = false;
          this.statusCallback('$(circle-slash)', `STT error: ${msg.message ?? 'unknown'}`);
          break;
      }
    });
  }

  setStatusCallback(cb: StatusCallback): void {
    this.statusCallback = cb;
  }

  start(): void {
    const config = vscode.workspace.getConfiguration('voice');
    const alwaysOn = config.get<boolean>('stt.alwaysOn', false);
    const wakeWord = config.get<string>('stt.wakeWord', 'hey claude');

    this.isListening = true;
    this.statusCallback('$(record)', 'Listening...');

    this.bridge.send({
      command: 'startListening',
      continuous: alwaysOn,
      wakeWord: alwaysOn ? wakeWord : undefined,
    });
  }

  stop(): void {
    this.isListening = false;
    this.statusCallback('$(unmute)', 'CC Speaker');
    this.bridge.send({ command: 'stopListening' });
  }

  private async handleTranscript(text: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('voice');
    const alwaysOn = config.get<boolean>('stt.alwaysOn', false);
    const wakeWord = config.get<string>('stt.wakeWord', 'hey claude').toLowerCase();

    let finalText = text;

    // In always-on mode, require wake word
    if (alwaysOn) {
      const lower = text.toLowerCase().trim();
      if (!lower.startsWith(wakeWord)) { return; }
      finalText = text.slice(wakeWord.length).trim();
    }

    if (!finalText) { return; }

    // One-shot mode: stop listening after getting a result
    if (!alwaysOn) {
      this.isListening = false;
      this.statusCallback('$(unmute)', 'CC Speaker');
      this.bridge.send({ command: 'stopListening' });
    }

    await this.injectToChat(finalText);
  }

  private async injectToChat(text: string): Promise<void> {
    // Try to open the Claude / Copilot chat panel
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open');
    } catch {
      // Chat panel not available — fall through to clipboard
    }

    // Write to clipboard so the user can paste, or automation can pick it up
    await vscode.env.clipboard.writeText(text);

    vscode.window.showInformationMessage(
      `CC Speaker heard: "${text}" — paste it into the chat input (Ctrl+V).`
    );
  }

  dispose(): void {
    void this.context; // satisfy strict mode
  }
}
