/*
 * Озвучка ответов (TTS) через встроенные голоса Windows (SAPI).
 * На Windows 10/11 есть русские голоса: Microsoft Irina / Pavel.
 */
(function () {
  let ruVoice = null;
  let onStateChange = null;

  function pickVoice() {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;
    ruVoice =
      voices.find((v) => /ru([-_]|$)/i.test(v.lang) && /irina|pavel/i.test(v.name)) ||
      voices.find((v) => /ru([-_]|$)/i.test(v.lang)) ||
      null;
  }

  pickVoice();
  window.speechSynthesis.onvoiceschanged = pickVoice;

  function speak(text) {
    if (!text) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (ruVoice) u.voice = ruVoice;
      u.lang = 'ru-RU';
      u.rate = 1.05;
      u.pitch = 0.95;
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

  window.JarvisTTS = {
    speak,
    stop,
    set onSpeaking(cb) {
      onStateChange = cb;
    },
    get hasRussianVoice() {
      return !!ruVoice;
    },
  };
})();
