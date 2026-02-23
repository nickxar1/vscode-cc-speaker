// CC Speaker — Audio Bridge
// Runs inside the hidden VS Code WebviewPanel (Chromium / Electron context).
// Communicates with the extension host via acquireVsCodeApi().postMessage.
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  // ── TTS ────────────────────────────────────────────────────────────────────

  let currentUtterance = null;

  function speak({ text, rate = 1, pitch = 1, voice = '' }) {
    if (!window.speechSynthesis) {
      vscode.postMessage({ command: 'error', message: 'SpeechSynthesis not available in this context' });
      return;
    }

    window.speechSynthesis.cancel();

    const utt = new SpeechSynthesisUtterance(text);
    utt.rate  = Math.max(0.1, Math.min(10, rate));
    utt.pitch = Math.max(0, Math.min(2, pitch));

    if (voice) {
      const match = window.speechSynthesis.getVoices().find((v) => v.name === voice);
      if (match) { utt.voice = match; }
    }

    utt.onstart = () => vscode.postMessage({ command: 'ttsStarted' });
    utt.onend   = () => { currentUtterance = null; vscode.postMessage({ command: 'ttsDone' }); };
    utt.onerror = (e) => {
      currentUtterance = null;
      vscode.postMessage({ command: 'error', message: e.error });
      vscode.postMessage({ command: 'ttsDone' });
    };

    currentUtterance = utt;
    window.speechSynthesis.speak(utt);
  }

  function stopSpeaking() {
    if (window.speechSynthesis) { window.speechSynthesis.cancel(); }
    currentUtterance = null;
  }

  // ── STT ────────────────────────────────────────────────────────────────────

  let recognition = null;
  let continuousMode = false;

  function startListening({ continuous = false, wakeWord }) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      vscode.postMessage({ command: 'error', message: 'SpeechRecognition not available in this context' });
      return;
    }

    stopListening();

    continuousMode = continuous;
    recognition = new SR();
    recognition.continuous     = continuous;
    recognition.interimResults = true;
    recognition.lang           = 'en-US';

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        vscode.postMessage({
          command : 'transcript',
          text    : result[0].transcript,
          isFinal : result.isFinal,
        });
      }
    };

    recognition.onerror = (event) => {
      // 'no-speech' is expected during silence — not a real error
      if (event.error !== 'no-speech') {
        vscode.postMessage({ command: 'error', message: event.error });
      }
    };

    recognition.onend = () => {
      // In continuous mode, auto-restart if recognition stops unexpectedly
      if (continuousMode && recognition) {
        try { recognition.start(); } catch { /* already running or disposed */ }
      }
    };

    try {
      recognition.start();
    } catch (err) {
      vscode.postMessage({ command: 'error', message: String(err) });
    }
  }

  function stopListening() {
    continuousMode = false;
    if (recognition) {
      try { recognition.abort(); } catch { /* ignore */ }
      recognition = null;
    }
  }

  // ── Message router ─────────────────────────────────────────────────────────

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || !msg.command) { return; }

    switch (msg.command) {
      case 'speak':
        speak(msg);
        break;
      case 'stopSpeaking':
        stopSpeaking();
        break;
      case 'startListening':
        startListening(msg);
        break;
      case 'stopListening':
        stopListening();
        break;
      default:
        break;
    }
  });

  // ── Voice list ─────────────────────────────────────────────────────────────

  function sendVoices() {
    if (!window.speechSynthesis) { return; }
    const voices = window.speechSynthesis.getVoices().map((v) => v.name);
    if (voices.length > 0) {
      vscode.postMessage({ command: 'voicesLoaded', voices });
    }
  }

  if (window.speechSynthesis) {
    window.speechSynthesis.addEventListener('voiceschanged', sendVoices);
    // Voices may already be loaded synchronously in some browsers
    sendVoices();
  }

  // Signal to the extension that the bridge is ready
  vscode.postMessage({ command: 'bridgeReady' });

})();
