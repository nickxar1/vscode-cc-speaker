import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AudioBridge } from './AudioBridge';

type StatusCallback = (icon: string, tooltip?: string) => void;

interface BridgeMsg { command: string; [k: string]: unknown; }

export class TTSController implements vscode.Disposable {
  private queue: string[] = [];
  private isSpeaking = false;
  private statusCallback: StatusCallback = () => { /* noop */ };
  private readonly disposables: vscode.Disposable[] = [];
  private fileWatcher: fs.FSWatcher | undefined;
  private lastFileSize = 0;
  private availableVoices: string[] = [];
  private lastTypedAt = 0;
  private pendingSpeakTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly bridge: AudioBridge,
    context: vscode.ExtensionContext
  ) {
    bridge.onMessage.on('message', (msg: BridgeMsg) => {
      switch (msg.command) {
        case 'ttsStarted':
          this.isSpeaking = true;
          this.statusCallback('$(unmute)', 'Speaking...');
          break;
        case 'ttsDone':
          this.isSpeaking = false;
          this.statusCallback('$(unmute)', 'CC Speaker');
          this.drainQueue();
          break;
        case 'error':
          this.isSpeaking = false;
          this.statusCallback('$(circle-slash)', `TTS error: ${msg['message'] as string}`);
          this.drainQueue();
          break;
        case 'voicesLoaded':
          this.availableVoices = (msg['voices'] as string[] | undefined) ?? [];
          break;
      }
    });

    // Track typing so auto-read is suppressed while the user is actively typing
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(() => { this.lastTypedAt = Date.now(); })
    );

    // Re-apply file watcher whenever config changes
    const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('voice.claude')) {
        this.applyFileWatcher();
      }
    });

    this.disposables.push(configWatcher);
    void context;

    // Start file watcher if already enabled in settings
    this.applyFileWatcher();
  }

  setStatusCallback(cb: StatusCallback): void {
    this.statusCallback = cb;
  }

  speak(text: string): void {
    const config = vscode.workspace.getConfiguration('voice');
    if (!config.get<boolean>('tts.enabled', true)) { return; }

    const cleaned = this.processText(text);
    if (!cleaned) { return; }

    this.queue.push(cleaned);
    if (!this.isSpeaking) { this.drainQueue(); }
  }

  stop(): void {
    this.queue = [];
    this.isSpeaking = false;
    this.bridge.send({ command: 'stopSpeaking' });
    this.statusCallback('$(mute)', 'Stopped');
  }

  // ── Claude response file watcher ──────────────────────────────────────────

  private resolveWatchFilePath(): string {
    const config = vscode.workspace.getConfiguration('voice');
    const custom = config.get<string>('claude.watchFilePath', '').trim();
    if (custom) { return custom; }
    return path.join(os.homedir(), '.claude', 'cc_speaker.txt');
  }

  private applyFileWatcher(): void {
    // Tear down existing watcher first
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = undefined;
    }

    const config = vscode.workspace.getConfiguration('voice');
    if (!config.get<boolean>('claude.watchFile', false)) { return; }

    const filePath = this.resolveWatchFilePath();

    // Ensure the file exists so we can watch it
    try {
      if (!fs.existsSync(filePath)) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '');
      }
      this.lastFileSize = fs.statSync(filePath).size;
    } catch {
      vscode.window.showWarningMessage(`CC Speaker: Cannot create watch file at ${filePath}`);
      return;
    }

    this.fileWatcher = fs.watch(filePath, () => {
      this.onWatchFileChanged(filePath);
    });
  }

  private onWatchFileChanged(filePath: string): void {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size <= this.lastFileSize) {
        // File was truncated/reset — update cursor, nothing to speak
        this.lastFileSize = stat.size;
        return;
      }

      // Read only the NEW bytes appended since last read
      const buf = Buffer.alloc(stat.size - this.lastFileSize);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buf, 0, buf.length, this.lastFileSize);
      fs.closeSync(fd);
      this.lastFileSize = stat.size;

      const newText = buf.toString('utf8').trim();
      if (newText.length > 0) {
        this.scheduleSpeak(newText);
      }
    } catch {
      // File may be temporarily locked — ignore
    }
  }

  // ── Voice picker ──────────────────────────────────────────────────────────

  async pickVoice(): Promise<void> {
    if (this.availableVoices.length === 0) {
      vscode.window.showInformationMessage('CC Speaker: No voices loaded yet — try again in a moment.');
      return;
    }
    const config = vscode.workspace.getConfiguration('voice');
    const current = config.get<string>('tts.voice', '');
    const items = [
      { label: '$(unmute) System default', description: current === '' ? '(current)' : '', voice: '' },
      ...this.availableVoices.map((v) => ({
        label: v,
        description: v === current ? '(current)' : '',
        voice: v,
      })),
    ];
    const pick = await vscode.window.showQuickPick(items, {
      title: 'CC Speaker — Pick a voice',
      placeHolder: 'Search voices...',
    });
    if (!pick) { return; }
    await config.update('voice.tts.voice', pick.voice, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(
      `CC Speaker: Voice set to "${pick.voice || 'system default'}"`
    );
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private scheduleSpeak(text: string): void {
    clearTimeout(this.pendingSpeakTimer);
    const COOLDOWN_MS = 2000;
    const trySpeak = () => {
      const elapsed = Date.now() - this.lastTypedAt;
      if (elapsed >= COOLDOWN_MS) {
        this.speak(text);
      } else {
        this.pendingSpeakTimer = setTimeout(trySpeak, COOLDOWN_MS - elapsed);
      }
    };
    // Small initial debounce so rapid file-write events collapse into one
    this.pendingSpeakTimer = setTimeout(trySpeak, 300);
  }

  private drainQueue(): void {
    if (this.queue.length === 0) { return; }
    const text = this.queue.shift()!;
    const config = vscode.workspace.getConfiguration('voice');
    this.bridge.send({
      command: 'speak',
      text,
      rate: config.get<number>('tts.rate', 1.0),
      pitch: config.get<number>('tts.pitch', 1.0),
      voice: config.get<string>('tts.voice', ''),
    });
  }

  private processText(raw: string): string {
    let text = raw;
    // Announce fenced code blocks rather than reading raw code
    text = text.replace(/```[\s\S]*?```/g, ' code block. ');
    // Inline code — strip backticks
    text = text.replace(/`[^`]*`/g, (m) => m.replace(/`/g, ' '));
    // Bold / italic
    text = text.replace(/\*\*(.+?)\*\*/gs, '$1');
    text = text.replace(/\*(.+?)\*/gs, '$1');
    text = text.replace(/_{1,2}(.+?)_{1,2}/gs, '$1');
    // ATX headings
    text = text.replace(/^#{1,6}\s+/gm, '');
    // Markdown links — keep visible text
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    // Horizontal rules
    text = text.replace(/^[-*_]{3,}\s*$/gm, '');

    // ── Pronunciation fixes ────────────────────────────────────────────────
    // 1. Known words the TTS engine mispronounces — add entries as needed
    const substitutions: Record<string, string> = {
      'README':  'read me',
      'plugin':  'plug in',
      'plugins': 'plug ins',
    };
    for (const [word, replacement] of Object.entries(substitutions)) {
      text = text.replace(new RegExp(`\\b${word}\\b`, 'gi'), replacement);
    }

    // 2. CamelCase / PascalCase → insert spaces
    //    "HTMLParser" → "HTML Parser", "AudioBridge" → "Audio Bridge"
    text = text.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
    //    "camelCase" → "camel Case", "ComfyUI" → "Comfy UI"
    text = text.replace(/([a-z\d])([A-Z])/g, '$1 $2');

    // 3. Remaining ALL_CAPS words (2+ letters) → spell out letter by letter
    //    "API" → "A P I", "CSS" → "C S S"
    text = text.replace(/\b([A-Z]{2,})\b/g, (match) => match.split('').join(' '));

    // Collapse whitespace
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }

  dispose(): void {
    clearTimeout(this.pendingSpeakTimer);
    if (this.fileWatcher) { this.fileWatcher.close(); }
    this.disposables.forEach((d) => d.dispose());
  }
}
