# CC Speaker — Voice for VS Code

A VS Code extension that adds voice capabilities to your Claude Code workflow.
Text-to-speech reads code and responses aloud. Speech-to-text lets you talk instead of type.
No external API keys required for basic use — runs entirely via the browser's Web Speech API inside a hidden Chromium webview.

---

## Features

### Phase 1 — Text-to-Speech (TTS) ✅
- **Speak selected text** — select anything in the editor and read it aloud
- **Auto-read** — automatically reads file changes as they happen (e.g. when Claude Code edits a file)
- **Markdown stripping** — removes `**`, `#`, backticks before speaking so formatting symbols aren't read aloud
- **Code block detection** — announces "code block" instead of reading raw code
- **Text queue** — rapid successive messages are queued and spoken in order
- **Status bar** — always-visible `Voice` item in the bottom-right shows current state

### Phase 2 — Speech-to-Text (STT) ✅
- **Push-to-talk** — hold a hotkey, speak, transcript is copied to clipboard for pasting into chat
- **Always-on mode** — continuous listening with a configurable wake word (e.g. "hey claude")
- **Wake word stripping** — wake word is removed before the transcript is sent

---

## Keybindings

| Action | Shortcut |
|---|---|
| Speak selected text | `Ctrl+Alt+R` |
| Stop speaking | `Ctrl+Alt+X` |
| Start listening (mic) | `Ctrl+Alt+M` |
| Stop listening | `Ctrl+Alt+.` |
| Toggle TTS on/off | Click `Voice` in status bar |
| All commands | `Ctrl+Shift+P` → type `Voice` |

---

## Installation (Development)

```bash
git clone https://github.com/yourname/vscode-cc-speaker
cd vscode-cc-speaker
npm install
npm run build
```

Then open the folder in VS Code and press **F5** — a second VS Code window (Extension Development Host) launches with the extension active.

---

## Configuration

Open settings via `Ctrl+Shift+P` → **Voice: Open Settings**, or search for `voice` in VS Code Settings.

| Setting | Default | Description |
|---|---|---|
| `voice.tts.enabled` | `true` | Enable/disable TTS globally |
| `voice.tts.autoRead` | `true` | Auto-read document changes |
| `voice.tts.rate` | `1.0` | Speech rate (0.5 slow → 2.0 fast) |
| `voice.tts.pitch` | `1.0` | Speech pitch (0.5 → 2.0) |
| `voice.tts.voice` | `""` | Voice name (empty = system default) |
| `voice.stt.provider` | `webSpeech` | STT engine (`webSpeech` or `whisper`) |
| `voice.stt.whisperApiKey` | `""` | OpenAI key (only for Whisper) |
| `voice.stt.wakeWord` | `hey claude` | Wake word for always-on mode |
| `voice.stt.alwaysOn` | `false` | Always-on continuous listening |

---

## Architecture

VS Code's Node.js runtime has no audio access. The solution is a hidden **WebviewPanel** running in Electron's Chromium context, which has full Web Speech API access. It communicates with the extension host via `postMessage`.

```
Extension Host (Node.js)          Hidden Webview (Chromium)
─────────────────────────         ──────────────────────────
TTSController                     bridge.js
  └─ sends text           →       SpeechSynthesis.speak()
     postMessage

STTController                     bridge.js
  └─ startListening       →       SpeechRecognition.start()
                          ←       posts back transcript
```

You will see a **CC Speaker Bridge** tab appear in the editor — this is the hidden webview. Leave it open; it's where the speech engine runs.

---

## Auto-read Claude Code Chat Responses

Claude Code's chat responses appear in a WebviewPanel that VS Code doesn't expose as a document. To bridge this, CC Speaker watches a file that a Claude Code hook writes to.

### Setup (one-time)

**1. Enable in settings:**
```
voice.claude.watchFile = true
```
The default watch file path is `~/.claude/cc_speaker.txt` (auto-created if missing). Override with `voice.claude.watchFilePath`.

**2. Add a Claude Code hook** — create or edit `~/.claude/settings.json`:
```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"const fs=require('fs'),d=require('os').homedir()+'/.claude/cc_speaker.txt';let t='';process.stdin.on('data',c=>t+=c);process.stdin.on('end',()=>{try{const m=JSON.parse(t).last_assistant_message;if(m)fs.appendFileSync(d,m+'\\n');}catch{}});\""
          }
        ]
      }
    ]
  }
}
```

This hook runs when Claude Code finishes a response and appends the text to the watch file. CC Speaker detects the append, reads only the new bytes, and speaks them.

> **Note:** The `Stop` hook receives Claude's final response on stdin. The command above appends it to `~/.claude/cc_speaker.txt`. Restart Claude Code after editing `settings.json`.

---

## Roadmap

- [ ] Auto-read Claude Code **chat responses** (not just file edits) — pending investigation of Claude extension's event API
- [ ] Voice picker UI — dropdown of available system voices
- [ ] Whisper STT backend for higher accuracy
- [ ] Suppress auto-read during active typing (smarter debounce)
- [ ] Hide the Bridge tab (use a sidebar WebviewView instead)

---

## File Structure

```
vscode-cc-speaker/
├── src/
│   ├── extension.ts        ← activate(), commands, status bar
│   ├── AudioBridge.ts      ← hidden WebviewPanel, postMessage routing
│   ├── TTSController.ts    ← text queue, markdown stripping, auto-read
│   ├── STTController.ts    ← listening, wake word, clipboard injection
│   └── webview/
│       ├── bridge.html     ← CSP shell for the hidden webview
│       └── bridge.js       ← SpeechSynthesis + SpeechRecognition
├── .vscode/
│   ├── launch.json         ← F5 config (extensionHost)
│   └── tasks.json          ← pre-launch build task
├── package.json
├── tsconfig.json
└── esbuild.js
```
