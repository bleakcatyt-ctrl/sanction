/*
 * Озвучка ответов (TTS) через встроенные голоса Windows (SAPI).
 * На Windows 10/11 есть русские голоса: Microsoft Irina / Pavel.
 * Выбранный голос и скорость сохраняются между запусками (localStorage).
 */
(function () {
  let currentVoice = null;
  let onStateChange = null;
  let rate = parseFloat(localStorage.getItem('jarvis.rate') || '1.05');
  let pitch = parseFloat(localStorage.getItem('jarvis.pitch') || '0.95');

  // Русские имена → как они пишутся в названиях голосов Windows
  const NAME_MAP = {
    'ирина': 'irina',
    'павел': 'pavel',
    'дмитрий': 'dmitry',
    'елена': 'elena',
    'светлана': 'svetlana',
    'александр': 'alexander',
    'мария': 'maria',
    'катя': 'katja',
    'милена': 'milena',
    'женский': 'irina',
    'мужской': 'pavel',
  };

  function voices() {
    return window.speechSynthesis.getVoices();
  }
  function ruVoices() {
    return voices().filter((v) => /ru([-_]|$)/i.test(v.lang));
  }

  function pickVoice() {
    const all = voices();
    if (!all.length) return;
    const savedName = localStorage.getItem('jarvis.voice');
    currentVoice =
      (savedName && all.find((v) => v.name === savedName)) ||
      all.find((v) => /ru([-_]|$)/i.test(v.lang) && /irina|pavel/i.test(v.name)) ||
      all.find((v) => /ru([-_]|$)/i.test(v.lang)) ||
      null;
  }

  pickVoice();
  window.speechSynthesis.onvoiceschanged = pickVoice;

  function speak(text) {
    if (!text) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (currentVoice) u.voice = currentVoice;
      u.lang = currentVoice ? currentVoice.lang : 'ru-RU';
      u.rate = rate;
      u.pitch = pitch;
      u.onstart = () => onStateChange && onStateChange(true);
      u.onend = () => onStateChange && onStateChange(false);
      u.onerror = () => onStateChange && onStateChange(false);
      window.speechSynthesis.speak(u);
    } catch (e) {
      console.error('TTS error:', e);
    }
  }

  function stop() {
    window.speechSynthesis.cancel();
    onStateChange && onStateChange(false);
  }

  // ---------- управление голосом ----------
  function listVoices() {
    // русские — первыми, остальные после
    const ru = ruVoices();
    const rest = voices().filter((v) => !ru.includes(v));
    return [...ru, ...rest].map((v) => ({
      name: v.name,
      lang: v.lang,
      current: currentVoice && v.name === currentVoice.name,
    }));
  }

  function saveVoice(v) {
    currentVoice = v;
    localStorage.setItem('jarvis.voice', v.name);
    return v.name;
  }

  /**
   * Выбор голоса по запросу: номер из списка («голос 2»),
   * русское имя («голос павел»), кусок названия («голос pavel»).
   * Возвращает имя нового голоса или null.
   */
  function setVoiceByQuery(query) {
    const q = String(query).toLowerCase().trim();
    const ordered = listVoices();
    if (!ordered.length) return null;

    // по номеру
    if (/^\d+$/.test(q)) {
      const idx = parseInt(q, 10) - 1;
      if (idx >= 0 && idx < ordered.length) {
        const v = voices().find((x) => x.name === ordered[idx].name);
        return v ? saveVoice(v) : null;
      }
      return null;
    }

    // по имени (русскому или латиницей)
    const needle = NAME_MAP[q] || q;
    const v =
      voices().find((x) => x.name.toLowerCase().includes(needle)) ||
      voices().find((x) => x.name.toLowerCase().includes(q));
    return v ? saveVoice(v) : null;
  }

  /** Переключиться на следующий русский голос по кругу. */
  function cycleVoice() {
    const pool = ruVoices().length ? ruVoices() : voices();
    if (!pool.length) return null;
    const i = currentVoice
      ? pool.findIndex((v) => v.name === currentVoice.name)
      : -1;
    return saveVoice(pool[(i + 1) % pool.length]);
  }

  function setRate(r) {
    rate = Math.max(0.5, Math.min(2, r));
    localStorage.setItem('jarvis.rate', String(rate));
    return rate;
  }

  window.JarvisTTS = {
    speak,
    stop,
    listVoices,
    setVoiceByQuery,
    cycleVoice,
    setRate,
    get rate() {
      return rate;
    },
    get currentVoiceName() {
      return currentVoice ? currentVoice.name : null;
    },
    set onSpeaking(cb) {
      onStateChange = cb;
    },
    get hasRussianVoice() {
      return ruVoices().length > 0;
    },
  };
})();
