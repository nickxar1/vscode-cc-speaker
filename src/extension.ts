import * as vscode from 'vscode';
import { AudioBridge } from './AudioBridge';
import { TTSController } from './TTSController';
import { STTController } from './STTController';

export function activate(context: vscode.ExtensionContext): void {
  const bridge = new AudioBridge(context);
  const tts = new TTSController(bridge, context);
  const stt = new STTController(bridge, context);

  // ── Status bar ─────────────────────────────────────────────────────────────
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.text = '$(unmute) Voice';
  statusBar.tooltip = 'CC Speaker — click to toggle TTS';
  statusBar.command = 'voice.toggleTTS';
  statusBar.show();

  function setStatus(icon: string, tooltip?: string): void {
    statusBar.text = `${icon} Voice`;
    if (tooltip) { statusBar.tooltip = tooltip; }
  }

  tts.setStatusCallback(setStatus);
  stt.setStatusCallback(setStatus);

  // ── Commands ───────────────────────────────────────────────────────────────
  const commands = [
    vscode.commands.registerCommand('voice.toggleTTS', () => {
      const config = vscode.workspace.getConfiguration('voice');
      const enabled = config.get<boolean>('tts.enabled', true);
      config.update('tts.enabled', !enabled, vscode.ConfigurationTarget.Global);
      if (enabled) {
        tts.stop();
        setStatus('$(mute)', 'TTS disabled');
      } else {
        setStatus('$(unmute)', 'TTS enabled');
      }
    }),

    vscode.commands.registerCommand('voice.speakSelection', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const text = editor.document.getText(editor.selection);
      if (text.trim()) {
        tts.speak(text);
      } else {
        vscode.window.showInformationMessage('CC Speaker: No text selected.');
      }
    }),

    vscode.commands.registerCommand('voice.stopSpeaking', () => {
      tts.stop();
    }),

    vscode.commands.registerCommand('voice.startListening', () => {
      stt.start();
    }),

    vscode.commands.registerCommand('voice.stopListening', () => {
      stt.stop();
    }),

    vscode.commands.registerCommand('voice.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'voice');
    }),
  ];

  context.subscriptions.push(statusBar, bridge, tts, ...commands);
}

export function deactivate(): void {
  // Disposables registered on context are cleaned up automatically
}
