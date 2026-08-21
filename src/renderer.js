/*
 * Рендерер: интерфейс, голосовой цикл с активацией «Джарвис»,
 * связка STT → команды → TTS.
 */
const { ipcRenderer } = require('electron');

// ---------- элементы ----------
const $ = (sel) => document.querySelector(sel);
const logEl = $('#log');
const inputEl = $('#cmd-input');
const micBtn = $('#btn-mic');
const reactor = $('#reactor');
const statusEl = $('#status');
const statusText = $('#status-text');

// ---------- состояние голосового цикла ----------
// idle      — слушаем только слово «джарвис»
// awaiting  — услышали «джарвис», ждём команду
// disabled  — микрофон недоступен/выключен
let voiceState = 'disabled';
let awaitingTimer = null;
let paths = null;

const WAKE_WORDS = ['джарвис', 'жарвис', 'джервис', 'ярвис', 'jarvis'];

// ---------- окно ----------
$('#btn-min').onclick = () => ipcRenderer.send('win:minimize');
$('#btn-hide').onclick = () => ipcRenderer.send('win:hide');

// ---------- лог ----------
function addMsg(html, cls) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  div.innerHTML = html;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  // не даём логу разрастаться бесконечно
  while (logEl.children.length > 300) logEl.removeChild(logEl.firstChild);
}
const printUser = (t) => addMsg(escapeHtml(t), 'user');
const printJarvis = (t) => addMsg(t, 'jarvis'); // разрешаем простую разметку
const printSys = (t) => addMsg(escapeHtml(t), 'sys');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------- статус ----------
function setStatus(text, kind) {
  statusText.textContent = text;
  statusEl.className = kind || '';
}

function setReactor(mode) {
  reactor.className = mode;
}

// ---------- озвучка ----------
function stripForSpeech(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .slice(0, 300);
}

window.JarvisTTS.onSpeaking = (speaking) => {
  if (speaking) setReactor('speaking');
  else setReactor(voiceState === 'awaiting' ? 'listening' : 'idle');
};

// ---------- контекст для команд ----------
const ctx = {
  reply(chatText, voiceText) {
    printJarvis(chatText);
    window.JarvisTTS.speak(voiceText != null ? voiceText : stripForSpeech(chatText));
  },
  sys: printSys,
  notify(title, body) {
    try {
      new Notification(title, { body });
    } catch (e) {}
  },
  get paths() {
    return paths;
  },
};

// ---------- выполнение команды ----------
async function execute(raw) {
  const text = String(raw || '').trim();
  if (!text) return;
  printUser(text);
  try {
    await window.JarvisCommands.handle(text, ctx);
  } catch (e) {
    console.error(e);
    printJarvis('Произошла ошибка при выполнении команды, сэр: ' + escapeHtml(e.message));
  }
}

// ---------- текстовый ввод ----------
$('#btn-send').onclick = () => {
  execute(inputEl.value);
  inputEl.value = '';
};
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    execute(inputEl.value);
    inputEl.value = '';
  }
});

// быстрые действия и подсказки
document.querySelectorAll('#quick-grid button').forEach((b) => {
  b.onclick = () => execute(b.dataset.cmd);
});
document.querySelectorAll('.hint').forEach((h) => {
  h.onclick = () => {
    inputEl.value = h.textContent;
    inputEl.focus();
  };
});

// ---------- звуковой сигнал активации ----------
function blip(freq) {
  try {
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.frequency.value = freq || 880;
    gain.gain.setValueAtTime(0.08, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.25);
    osc.connect(gain).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + 0.25);
    osc.onended = () => ac.close();
  } catch (e) {}
}

// ---------- голосовой цикл ----------
function enterAwaiting(sayIt) {
  voiceState = 'awaiting';
  setReactor('listening');
  micBtn.classList.add('rec');
  setStatus('Слушаю команду…', 'ok');
  blip(1046);
  if (sayIt) window.JarvisTTS.speak('Слушаю, сэр.');
  clearTimeout(awaitingTimer);
  awaitingTimer = setTimeout(() => {
    if (voiceState === 'awaiting') exitAwaiting();
  }, 10000);
}

function exitAwaiting() {
  if (voiceState !== 'disabled') voiceState = 'idle';
  setReactor('idle');
  micBtn.classList.remove('rec');
  setStatus('Жду слово «Джарвис» или команду с клавиатуры', 'ok');
  clearTimeout(awaitingTimer);
}

function stripWakeWord(text) {
  let t = ' ' + text.toLowerCase() + ' ';
  for (const w of WAKE_WORDS) t = t.replace(' ' + w + ' ', ' ');
  return t.trim();
}

function containsWakeWord(text) {
  const t = text.toLowerCase();
  return WAKE_WORDS.some((w) => t.includes(w));
}

function onSpeechResult(text) {
  if (voiceState === 'awaiting') {
    clearTimeout(awaitingTimer);
    exitAwaiting();
    const cmd = stripWakeWord(text);
    if (cmd) execute(cmd);
    return;
  }
  // idle: реагируем только на «джарвис»
  if (containsWakeWord(text)) {
    const rest = stripWakeWord(text);
    if (rest && rest.split(' ').length >= 2) {
      // «джарвис открой ютуб» — сразу выполняем
      execute(rest);
    } else {
      enterAwaiting(true);
    }
  }
}

function onSpeechPartial(text) {
  if (voiceState === 'idle' && containsWakeWord(text)) {
    // мгновенная реакция на имя, не дожидаясь конца фразы
    enterAwaiting(true);
  }
}

// кнопка микрофона = сразу режим «слушаю команду»
micBtn.onclick = () => {
  if (voiceState === 'disabled') {
    printJarvis('Голос недоступен: не удалось запустить распознавание. Текстовые команды работают.');
    return;
  }
  if (voiceState === 'awaiting') exitAwaiting();
  else enterAwaiting(false);
};

// ---------- запуск ----------
async function boot() {
  paths = await ipcRenderer.invoke('app:paths');
  window.JarvisCommands.ensureCustomCommands(paths.userData);

  printJarvis(
    'Здравствуйте, сэр. Я <b>Джарвис</b> — ваш ассистент быстрых действий.\n' +
      '• Скажите «<b>Джарвис</b>» и назовите команду, либо введите её с клавиатуры.\n' +
      '• «<b>помощь</b>» — полный список команд. Окно вызывается по <b>Alt+J</b>.'
  );

  // Голос
  window.JarvisSTT.onStatus = (t) => setStatus(t);
  window.JarvisSTT.onResult = onSpeechResult;
  window.JarvisSTT.onPartial = onSpeechPartial;

  try {
    setStatus('Подготовка распознавания речи…');
    await window.JarvisSTT.init(paths.userData);
    await window.JarvisSTT.start();
    voiceState = 'idle';
    exitAwaiting();
    printSys('Голосовое управление активно — скажите «Джарвис».');
  } catch (e) {
    console.error('STT init failed:', e);
    voiceState = 'disabled';
    setReactor('off');
    micBtn.classList.add('disabled');
    setStatus('Голос недоступен (нет микрофона или интернета для загрузки модели). Текст работает.', 'err');
    printSys('Голос недоступен: ' + e.message + '. Текстовые команды работают как обычно.');
  }

  inputEl.focus();
}

boot();
