# VS Code Voice Extension — Claude Code Instructions

## Project Overview

A VS Code extension that adds voice capabilities to the Claude VS Code experience. Built in TypeScript, using a hidden WebviewPanel as an audio bridge to access browser-based audio APIs (Web Speech API) from within the Node.js extension host.

## Project Goals

### Phase 1 — Text-to-Speech (TTS)
Read Claude's code/chat output aloud automatically as it appears, using the Web Speech API via a hidden Webview. No external API keys required to start.

### Phase 2 — Voice-to-Chat (STT)
Allow the user to speak instead of type in Claude's chat input. Always-on listening mode with a wake word or hotkey trigger. Start with Web Speech API, optionally upgrade to OpenAI Whisper.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Bundler:** esbuild
- **Runtime:** VS Code Extension Host (Node.js) + Webview (Chromium)
- **Audio APIs:** Web Speech API (`SpeechSynthesis`, `SpeechRecognition`) running inside a hidden WebviewPanel
- **VS Code APIs:** `vscode.window`, `vscode.commands`, `vscode.WebviewPanel`, `vscode.workspace`
- **No external dependencies required for Phase 1**

## File Structure

```
voice-extension/
├── src/
│   ├── extension.ts          ← activate(), registers all commands, creates AudioBridge
│   ├── AudioBridge.ts        ← owns the hidden WebviewPanel, handles postMessage routing
│   ├── TTSController.ts      ← text-to-speech logic, queues text, sends to bridge
│   ├── STTController.ts      ← speech-to-text logic (Phase 2)
│   └── webview/
│       ├── bridge.html       ← minimal HTML shell for the hidden webview
│       └── bridge.js         ← Web Speech API implementation (SpeechSynthesis + SpeechRecognition)
├── package.json              ← extension manifest with commands, keybindings, config
├── tsconfig.json
├── esbuild.js                ← build script
└── CLAUDE.md                 ← this file
```

## Architecture: The Audio Bridge Pattern

VS Code's Node.js runtime cannot access audio hardware directly. The solution is a hidden `WebviewPanel` that:
1. Runs in a Chromium context with full Web API access
2. Communicates with the extension host via `postMessage` / `onDidReceiveMessage`
3. Is created once on activation and kept alive for the session

```
Extension Host (Node.js)          Hidden Webview (Chromium)
─────────────────────────         ──────────────────────────
TTSController                     bridge.js
  └─ sends text via          →    SpeechSynthesis.speak()
     panel.webview.postMessage

STTController                     bridge.js
  └─ sends {cmd:'startListen'} →  SpeechRecognition.start()
                             ←    panel.webview.onDidReceiveMessage
                                  posts back transcript
```

## Message Protocol (postMessage)

All messages between extension and webview follow this shape:

```typescript
// Extension → Webview
{ command: 'speak', text: string, rate?: number, pitch?: number, voice?: string }
{ command: 'stopSpeaking' }
{ command: 'startListening', continuous?: boolean, wakeWord?: string }
{ command: 'stopListening' }

// Webview → Extension
{ command: 'transcript', text: string, isFinal: boolean }
{ command: 'ttsStarted' }
{ command: 'ttsDone' }
{ command: 'error', message: string }
{ command: 'voicesLoaded', voices: string[] }
```

## VS Code Commands to Register

| Command ID | Title | Default Keybinding |
|---|---|---|
| `voice.toggleTTS` | Voice: Toggle Read Aloud | — |
| `voice.speakSelection` | Voice: Speak Selected Text | `Ctrl+Shift+S` |
| `voice.stopSpeaking` | Voice: Stop Speaking | `Escape` |
| `voice.startListening` | Voice: Start Listening | `Ctrl+Shift+V` |
| `voice.stopListening` | Voice: Stop Listening | — |
| `voice.openSettings` | Voice: Open Settings | — |

## Configuration (package.json contributes.configuration)

```json
"voice.tts.enabled": boolean (default: true)
"voice.tts.autoRead": boolean (default: true) — auto-read Claude responses
"voice.tts.rate": number 0.5–2.0 (default: 1.0)
"voice.tts.pitch": number 0.5–2.0 (default: 1.0)
"voice.tts.voice": string — voice name from system voices
"voice.stt.provider": "webSpeech" | "whisper" (default: "webSpeech")
"voice.stt.whisperApiKey": string — only used if provider is "whisper"
"voice.stt.wakeWord": string (default: "hey claude")
"voice.stt.alwaysOn": boolean (default: false)
```

## Key Implementation Notes

### AudioBridge.ts
- Create the WebviewPanel with `retainContextWhenHidden: true` so it stays alive
- Set `enableScripts: true` on webview options
- Use `getNonce()` for CSP — the webview HTML must have a strict Content Security Policy
- Expose a simple `send(message)` method and an `onMessage` event emitter for other controllers to use

### TTSController.ts
- Maintain a text queue so rapid successive messages don't overlap
- Strip markdown symbols (`**`, `#`, `` ` ``) before sending to TTS — they sound terrible when read aloud
- Detect code blocks and either skip them or announce "code block" before reading
- Watch `vscode.workspace.onDidChangeTextDocument` for auto-read, but debounce aggressively (500ms) to avoid reading mid-stream tokens

### STTController.ts (Phase 2)
- In always-on mode, use `SpeechRecognition` with `continuous: true` and `interimResults: true`
- Buffer interim results, only act on `isFinal: true` transcripts
- Wake word detection: check if transcript starts with the configured wake word, strip it before sending to Claude
- Injecting into Claude's chat: try `vscode.commands.executeCommand('workbench.action.chat.open')` then simulate input — may need to inspect Claude extension's command IDs

### Status Bar
- Always show a status bar item in the bottom bar indicating TTS/STT state
- Icons: `$(unmute)` speaking, `$(mute)` muted, `$(record)` listening, `$(circle-slash)` error

## Development Workflow

```bash
# Scaffold (first time only)
npm install -g yo generator-code
yo code  # choose TypeScript, no webpack

# Install deps
npm install --save-dev esbuild @types/vscode

# Build
node esbuild.js

# Run/debug — press F5 in VS Code to launch Extension Development Host
# Then open Command Palette → run any "Voice:" command to test
```

## Phase Delivery Order

1. **AudioBridge** — hidden webview + postMessage plumbing (validate with a console.log round-trip)
2. **TTS basic** — `voice.speakSelection` command works
3. **TTS auto-read** — watches document changes, reads Claude output
4. **Settings** — voice picker, rate/pitch sliders via VS Code config
5. **STT hotkey** — push-to-talk via `Ctrl+Shift+V`
6. **STT always-on** — continuous listening with wake word
7. **Whisper upgrade** — optional higher-accuracy backend

## Known Risks & Watch-Outs

- **Claude chat injection (Phase 2b):** The mechanism to inject a transcript into Claude's chat input depends on how the Claude VS Code extension exposes its UI. Investigate `vscode.commands.getCommands()` early to see what Claude extension commands are available. May need to use clipboard + paste as a fallback.
- **Mic permissions:** The Webview must call `navigator.mediaDevices.getUserMedia` to trigger the browser permission prompt. VS Code will show a native permission dialog — this is expected and fine.
- **CSP for webview:** The hidden webview's HTML needs a proper `Content-Security-Policy` meta tag or it will block scripts. Use a nonce-based CSP.
- **Voice availability:** `SpeechSynthesis.getVoices()` is async and fires `onvoiceschanged` — always wait for the event before populating the voice list.
- **Auto-read debouncing:** Claude streams tokens quickly. Debounce document change events heavily or you'll trigger hundreds of TTS calls per response.
