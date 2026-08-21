/*
 * Распознавание речи (STT) — полностью офлайн через Vosk (WASM).
 * Модель русского языка (~40 МБ) скачивается один раз при первом запуске
 * и сохраняется в папке данных приложения.
 */
(function () {
  const fs = require('fs');
  const path = require('path');

  const MODEL_URL =
    'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-ru-0.4.tar.gz';
  const MODEL_FILE = 'vosk-model-small-ru-0.4.tar.gz';

  let model = null;
  let recognizer = null;
  let audioCtx = null;
  let processor = null;
  let sourceNode = null;
  let mediaStream = null;
  let running = false;

  let onResult = null; // (text) => {}  финальная фраза
  let onPartial = null; // (text) => {} промежуточный текст
  let onStatus = null; // (text, kind) => {}

  function status(text, kind) {
    if (onStatus) onStatus(text, kind || 'info');
  }

  async function ensureModelFile(userDataDir) {
    const dest = path.join(userDataDir, MODEL_FILE);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1024 * 1024) {
      return dest;
    }
    status('Скачиваю модель распознавания речи (~40 МБ)…');
    const resp = await fetch(MODEL_URL);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    const total = Number(resp.headers.get('content-length')) || 0;
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total) {
        status(
          'Скачиваю модель речи… ' + Math.round((received / total) * 100) + '%'
        );
      }
    }
    const blob = new Blob(chunks);
    const buf = Buffer.from(await blob.arrayBuffer());
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(dest, buf);
    return dest;
  }

  async function init(userDataDir) {
    if (model) return true;
    const Vosk = require('vosk-browser');

    const filePath = await ensureModelFile(userDataDir);
    status('Загружаю модель речи в память…');

    // Vosk грузит модель по URL — отдаём локальный файл как blob:
    const data = fs.readFileSync(filePath);
    const blobUrl = URL.createObjectURL(
      new Blob([data], { type: 'application/gzip' })
    );
    model = await Vosk.createModel(blobUrl);
    return true;
  }

  async function start() {
    if (running || !model) return;

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
      video: false,
    });

    audioCtx = new AudioContext();
    recognizer = new model.KaldiRecognizer(audioCtx.sampleRate);
    recognizer.setWords(false);

    recognizer.on('result', (message) => {
      const text = (message.result && message.result.text || '').trim();
      if (text && onResult) onResult(text);
    });
    recognizer.on('partialresult', (message) => {
      const text = (message.result && message.result.partial || '').trim();
      if (text && onPartial) onPartial(text);
    });

    sourceNode = audioCtx.createMediaStreamSource(mediaStream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      try {
        recognizer.acceptWaveform(event.inputBuffer);
      } catch (e) {
        /* игнорируем единичные сбои буфера */
      }
    };

    // глухой выход, чтобы граф аудио работал без эха
    const silent = audioCtx.createGain();
    silent.gain.value = 0;
    sourceNode.connect(processor);
    processor.connect(silent);
    silent.connect(audioCtx.destination);

    running = true;
  }

  function stop() {
    running = false;
    try { processor && processor.disconnect(); } catch (e) {}
    try { sourceNode && sourceNode.disconnect(); } catch (e) {}
    try { audioCtx && audioCtx.close(); } catch (e) {}
    try {
      mediaStream && mediaStream.getTracks().forEach((t) => t.stop());
    } catch (e) {}
    try { recognizer && recognizer.remove(); } catch (e) {}
    processor = sourceNode = audioCtx = mediaStream = recognizer = null;
  }

  window.JarvisSTT = {
    init,
    start,
    stop,
    get running() {
      return running;
    },
    set onResult(cb) { onResult = cb; },
    set onPartial(cb) { onPartial = cb; },
    set onStatus(cb) { onStatus = cb; },
  };
})();
