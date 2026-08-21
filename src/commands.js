/*
 * Мозг Джарвиса: разбор русских команд и выполнение действий.
 * window.JarvisCommands.handle(text, ctx) -> Promise<boolean>
 *
 * ctx = {
 *   reply(textForChat, textForVoice?)  — ответ в чат + озвучка
 *   sys(text)                          — серое системное сообщение
 *   paths                              — системные папки (из main-процесса)
 *   notify(title, body)                — уведомление Windows
 * }
 */
(function () {
  const { exec } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { shell, ipcRenderer } = require('electron');

  const isWin = process.platform === 'win32';

  // ---------------------------------------------------------------
  // Справочники
  // ---------------------------------------------------------------
  const APPS = {
    'блокнот': { win: 'start "" notepad', kill: 'notepad.exe' },
    'калькулятор': { win: 'start "" calc' },
    'проводник': { win: 'start "" explorer' },
    'файлы': { win: 'start "" explorer' },
    'паинт': { win: 'start "" mspaint', kill: 'mspaint.exe' },
    'пеинт': { win: 'start "" mspaint', kill: 'mspaint.exe' },
    'ворд': { win: 'start "" winword', kill: 'WINWORD.EXE' },
    'эксель': { win: 'start "" excel', kill: 'EXCEL.EXE' },
    'консоль': { win: 'start "" cmd' },
    'терминал': { win: 'start "" cmd' },
    'командную строку': { win: 'start "" cmd' },
    'диспетчер задач': { win: 'start "" taskmgr' },
    'настройки': { win: 'start "" ms-settings:' },
    'параметры': { win: 'start "" ms-settings:' },
    'панель управления': { win: 'start "" control' },
    'хром': { win: 'start "" chrome', kill: 'chrome.exe' },
    'эдж': { win: 'start "" msedge', kill: 'msedge.exe' },
    'стим': { win: 'start "" steam://open/main', kill: 'steam.exe' },
    'дискорд': {
      win: '%LOCALAPPDATA%\\Discord\\Update.exe --processStart Discord.exe',
      kill: 'Discord.exe',
    },
  };

  const SITES = {
    'ютуб': 'https://www.youtube.com',
    'youtube': 'https://www.youtube.com',
    'гугл': 'https://www.google.com',
    'яндекс': 'https://ya.ru',
    'вк': 'https://vk.com',
    'вконтакте': 'https://vk.com',
    'телеграм': 'https://web.telegram.org',
    'телеграмм': 'https://web.telegram.org',
    'твич': 'https://www.twitch.tv',
    'гитхаб': 'https://github.com',
    'почту': 'https://mail.google.com',
    'почта': 'https://mail.google.com',
    'карты': 'https://yandex.ru/maps',
    'переводчик': 'https://translate.google.com',
    'кинопоиск': 'https://www.kinopoisk.ru',
    'рутуб': 'https://rutube.ru',
    'дзен': 'https://dzen.ru',
    'авито': 'https://www.avito.ru',
    'озон': 'https://www.ozon.ru',
    'вайлдберриз': 'https://www.wildberries.ru',
    'музыку': 'https://music.yandex.ru',
    'музыка': 'https://music.yandex.ru',
  };

  const JOKES = [
    'Программист — это машина по превращению кофе в код.',
    'Windows нашла ошибку. Она вам понравится.',
    'Не баг, а недокументированная фича, сэр.',
    'Искусственный интеллект никогда не заменит естественную глупость.',
    'Чтобы понять рекурсию, нужно сначала понять рекурсию.',
    'Оптимист верит, что мы живём в лучшем из миров. Пессимист боится, что так оно и есть.',
    'Я бы рассказал шутку про UDP, но не уверен, что она до вас дойдёт.',
    'Сон — это тоже перезагрузка, сэр. Рекомендую вам, а не компьютеру.',
  ];

  const HELP_TEXT = [
    '<b>Что я умею:</b>',
    '',
    '🚀 <b>Запуск:</b> «открой ютуб / блокнот / загрузки / стим», «открой сайт vk.com»',
    '🔊 <b>Звук:</b> «громкость 40», «громче», «тише», «без звука», «включи звук»',
    '💻 <b>Система:</b> «выключи компьютер», «перезагрузи», «спящий режим», «заблокируй», «отмена выключения», «очисти корзину», «закрой хром»',
    '📸 <b>Скриншот:</b> «скриншот» (сохраняю в Изображения\\Jarvis)',
    '🌍 <b>Поиск:</b> «найди рецепт борща», «найди в ютубе музыку для сна»',
    '⏱ <b>Таймеры:</b> «таймер 10 минут», «напомни через 30 минут позвонить маме»',
    '🧮 <b>Счёт:</b> «посчитай 25*4+10»',
    '📝 <b>Заметки:</b> «запиши купить хлеб», «покажи заметки», «очисти заметки»',
    '⛅ <b>Погода:</b> «погода», «погода в Москве»',
    'ℹ️ <b>Инфо:</b> «который час», «какая дата», «система», «мой айпи»',
    '🎲 <b>Разное:</b> «шутка», «монетка», «кубик», «случайное число от 1 до 100»',
    '',
    '⚙️ «мои команды» — открыть файл своих команд (свои программы и сайты)',
    '🗣 <b>Голос:</b> «голоса», «смени голос», «голос павел», «голос ирина», «говори быстрее / медленнее»',
    '🎤 Голос: скажи «Джарвис», дождись ответа и назови команду. Горячая клавиша окна — Alt+J.',
  ].join('\n');

  // ---------------------------------------------------------------
  // Утилиты
  // ---------------------------------------------------------------
  function normalize(text) {
    return text
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[!?.,;:«»"']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function run(cmdWin, cmdLinux) {
    return new Promise((resolve) => {
      const cmd = isWin ? cmdWin : cmdLinux || cmdWin;
      exec(cmd, { windowsHide: true, shell: isWin ? 'cmd.exe' : undefined }, (err) =>
        resolve(!err)
      );
    });
  }

  function ps(script) {
    // Запуск PowerShell без окна
    return new Promise((resolve) => {
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      exec(
        'powershell -NoProfile -WindowStyle Hidden -EncodedCommand ' + encoded,
        { windowsHide: true },
        (err, stdout) => resolve(err ? null : String(stdout || '').trim())
      );
    });
  }

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  // ---- громкость (через мультимедийные клавиши, без сторонних утилит) ----
  function volumeKeys(charCode, times) {
    const t = Math.max(1, Math.min(60, times));
    return ps(
      `$w = New-Object -ComObject WScript.Shell; 1..${t} | ForEach-Object { $w.SendKeys([char]${charCode}); Start-Sleep -Milliseconds 12 }`
    );
  }
  const volumeUp = (steps) => volumeKeys(175, steps);
  const volumeDown = (steps) => volumeKeys(174, steps);
  const volumeMute = () => volumeKeys(173, 1);
  async function volumeSet(percent) {
    const p = Math.max(0, Math.min(100, percent));
    await volumeDown(50); // до нуля
    if (p > 0) await volumeUp(Math.round(p / 2)); // каждая «клавиша» = 2%
  }

  // ---- своя память ----
  function fileIn(userData, name) {
    return path.join(userData, name);
  }
  function loadJSON(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      return fallback;
    }
  }
  function saveJSON(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }

  function ensureCustomCommands(userData) {
    const file = fileIn(userData, 'commands.json');
    if (!fs.existsSync(file)) {
      saveJSON(file, {
        '_подсказка': 'Слева — что говорить после «открой», справа — путь к программе или ссылка',
        'фотошоп': 'C:\\\\Program Files\\\\Adobe\\\\Photoshop\\\\Photoshop.exe',
        'мой сайт': 'https://example.com',
      });
    }
    return file;
  }

  // ---------------------------------------------------------------
  // Открытие целей
  // ---------------------------------------------------------------
  async function openTarget(name, ctx) {
    const target = name.trim();
    const userData = ctx.paths.userData;

    // 1. свои команды пользователя
    const custom = loadJSON(fileIn(userData, 'commands.json'), {});
    for (const key of Object.keys(custom)) {
      if (key.startsWith('_')) continue;
      if (normalize(key) === target) {
        const value = String(custom[key]);
        if (/^https?:\/\//i.test(value)) shell.openExternal(value);
        else if (isWin) exec(`start "" "${value}"`, { windowsHide: true });
        else exec(`xdg-open "${value}"`);
        ctx.reply(`Открываю «${key}», сэр.`);
        return true;
      }
    }

    // 2. браузер
    if (/^браузер/.test(target)) {
      shell.openExternal('https://www.google.com');
      ctx.reply('Открываю браузер, сэр.');
      return true;
    }

    // 3. системные папки
    const FOLDERS = {
      'загрузки': ctx.paths.downloads,
      'документы': ctx.paths.documents,
      'рабочий стол': ctx.paths.desktop,
      'картинки': ctx.paths.pictures,
      'изображения': ctx.paths.pictures,
      'фото': ctx.paths.pictures,
      'видео': ctx.paths.videos,
      'домашнюю папку': ctx.paths.home,
      'корзину': null,
    };
    for (const key of Object.keys(FOLDERS)) {
      if (target === key || target === key.replace(/у$/, 'а')) {
        if (key === 'корзину') {
          await run('start "" explorer shell:RecycleBinFolder');
        } else {
          shell.openPath(FOLDERS[key]);
        }
        ctx.reply(`Открываю «${key}», сэр.`);
        return true;
      }
    }

    // 4. приложения
    for (const key of Object.keys(APPS)) {
      if (target === key || target.startsWith(key + ' ')) {
        await run(APPS[key].win, `xdg-open .`);
        ctx.reply(`Запускаю ${key}, сэр.`);
        return true;
      }
    }

    // 5. сайты
    for (const key of Object.keys(SITES)) {
      if (target === key || target.startsWith(key + ' ')) {
        shell.openExternal(SITES[key]);
        ctx.reply(`Открываю ${key}, сэр.`);
        return true;
      }
    }

    // 6. похоже на адрес сайта
    if (/^[a-z0-9а-я-]+\.[a-zа-я]{2,}/i.test(target)) {
      shell.openExternal('https://' + target.replace(/^https?:\/\//, ''));
      ctx.reply(`Открываю ${target}, сэр.`);
      return true;
    }

    // 7. последний шанс — пусть Windows сама поищет программу
    if (isWin) {
      const ok = await run(`start "" ${target.split(' ')[0]}`);
      if (ok) {
        ctx.reply(`Пробую запустить «${target}», сэр.`);
        return true;
      }
    }

    ctx.reply(
      `Не знаю, что такое «${target}», сэр. Добавьте это в свои команды — скажите «мои команды».`
    );
    return true;
  }

  // ---------------------------------------------------------------
  // Погода
  // ---------------------------------------------------------------
  async function weather(city, ctx) {
    const where = city || '';
    ctx.sys('Запрашиваю погоду…');
    try {
      const resp = await fetch(
        'https://wttr.in/' + encodeURIComponent(where) + '?format=j1&lang=ru',
        { signal: AbortSignal.timeout(10000) }
      );
      const data = await resp.json();
      const cur = data.current_condition[0];
      const area = data.nearest_area && data.nearest_area[0];
      const place = city
        ? city
        : area
        ? (area.areaName[0].value || 'вашем районе')
        : 'вашем районе';
      const desc =
        (cur.lang_ru && cur.lang_ru[0] && cur.lang_ru[0].value) ||
        cur.weatherDesc[0].value;
      const text = `Сейчас в ${place}: ${desc.toLowerCase()}, ${cur.temp_C}°C (ощущается как ${cur.FeelsLikeC}°C), ветер ${Math.round(cur.windspeedKmph / 3.6)} м/с, влажность ${cur.humidity}%.`;
      ctx.reply(text);
    } catch (e) {
      ctx.reply('Не удалось получить погоду, сэр. Проверьте интернет.');
    }
    return true;
  }

  // ---------------------------------------------------------------
  // Скриншот
  // ---------------------------------------------------------------
  async function screenshot(ctx) {
    const dir = path.join(ctx.paths.pictures, 'Jarvis');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const file = path.join(dir, `screenshot-${stamp}.png`);

    if (!isWin) {
      ctx.reply('Скриншоты я делаю только на Windows, сэр.');
      return true;
    }

    // прячем собственное окно, чтобы не попало в кадр
    await ipcRenderer.invoke('win:conceal', 450);
    await ps(`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$bmp.Save('${file.replace(/\\/g, '\\\\')}')
$g.Dispose(); $bmp.Dispose()
`);
    ipcRenderer.send('win:reveal');

    if (fs.existsSync(file)) {
      ctx.reply('Скриншот готов, сэр. Открываю папку.');
      shell.showItemInFolder(file);
    } else {
      ctx.reply('Не получилось сделать скриншот, сэр.');
    }
    return true;
  }

  // ---------------------------------------------------------------
  // Главный обработчик
  // ---------------------------------------------------------------
  async function handle(raw, ctx) {
    const text = normalize(raw);
    if (!text) return false;
    let m;

    // --- приветствия и болтовня ---
    if (/^(привет|здравствуй|здорово|хай|добрый (день|вечер)|доброе утро)/.test(text)) {
      const h = new Date().getHours();
      const g = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
      ctx.reply(`${g}, сэр. Чем могу помочь?`);
      return true;
    }
    if (/как (у тебя )?дела|как ты/.test(text)) {
      ctx.reply('Все системы в норме, сэр. Готов к работе.');
      return true;
    }
    if (/^(спасибо|благодарю)/.test(text)) {
      ctx.reply('Всегда к вашим услугам, сэр.');
      return true;
    }
    if (/кто ты|как тебя зовут/.test(text)) {
      ctx.reply('Я Джарвис — ваш персональный ассистент. Скажите «помощь», и я покажу, что умею.');
      return true;
    }
    if (/^(помощь|справка|команды|что ты умеешь|хелп)$/.test(text) || /что ты умеешь/.test(text)) {
      ctx.reply(HELP_TEXT, 'Вот список моих команд, сэр.');
      return true;
    }

    // --- время и дата ---
    if (/который час|сколько времени|^время$|скажи время/.test(text)) {
      const now = new Date();
      const t = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      ctx.reply(`Сейчас ${t}, сэр.`);
      return true;
    }
    if (/какое (сегодня )?число|какая (сегодня )?дата|^дата$|какой (сегодня )?день/.test(text)) {
      const now = new Date();
      const d = now.toLocaleDateString('ru-RU', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });
      ctx.reply(`Сегодня ${d}, сэр.`);
      return true;
    }

    // --- таймер / напоминание ---
    if ((m = text.match(/^таймер( на)? (\d+) ?(секунд\w*|минут\w*|час\w*)?/))) {
      const n = parseInt(m[2], 10);
      const unit = m[3] || 'минут';
      let msec = n * 60000;
      let label = `${n} ${plural(n, 'минуту', 'минуты', 'минут')}`;
      if (unit.startsWith('сек')) { msec = n * 1000; label = `${n} ${plural(n, 'секунду', 'секунды', 'секунд')}`; }
      if (unit.startsWith('час')) { msec = n * 3600000; label = `${n} ${plural(n, 'час', 'часа', 'часов')}`; }
      ctx.reply(`Таймер на ${label} запущен, сэр.`);
      setTimeout(() => {
        ctx.notify('⏰ JARVIS', `Таймер на ${label} завершён!`);
        ctx.reply(`⏰ Сэр, таймер на ${label} завершён!`);
      }, msec);
      return true;
    }
    if ((m = text.match(/^напомни( мне)? через (\d+) ?(секунд\w*|минут\w*|час\w*)?( ?(.*))?$/))) {
      const n = parseInt(m[2], 10);
      const unit = m[3] || 'минут';
      const what = (m[5] || '').trim() || 'вы просили напомнить';
      let msec = n * 60000;
      if (unit.startsWith('сек')) msec = n * 1000;
      if (unit.startsWith('час')) msec = n * 3600000;
      ctx.reply(`Хорошо, сэр. Напомню через ${n} ${unit || 'минут'}: «${what}».`);
      setTimeout(() => {
        ctx.notify('🔔 JARVIS — напоминание', what);
        ctx.reply(`🔔 Сэр, напоминаю: ${what}`);
      }, msec);
      return true;
    }

    // --- калькулятор ---
    if ((m = raw.toLowerCase().match(/(?:посчитай|сколько будет|вычисли)\s+(.+)/))) {
      let expr = m[1]
        .replace(/,/g, '.')
        .replace(/х|умножить на|умножить/g, '*')
        .replace(/плюс/g, '+')
        .replace(/минус/g, '-')
        .replace(/разделить на|делить на|поделить на/g, '/')
        .replace(/в степени/g, '**')
        .replace(/\^/g, '**')
        .replace(/[^0-9+\-*/().\s%]/g, '')
        .trim();
      try {
        if (!expr) throw new Error('empty');
        // eslint-disable-next-line no-new-func
        const result = Function('"use strict"; return (' + expr + ')')();
        if (typeof result !== 'number' || !isFinite(result)) throw new Error('NaN');
        const pretty = Math.round(result * 1e6) / 1e6;
        ctx.reply(`${expr} = ${pretty}`, `Получается ${pretty}, сэр.`);
      } catch (e) {
        ctx.reply('Не смог посчитать это выражение, сэр.');
      }
      return true;
    }

    // --- заметки ---
    const notesFile = fileIn(ctx.paths.userData, 'notes.json');
    if ((m = raw.match(/^(?:запиши|заметка|запомни)\s+(.+)/i))) {
      const notes = loadJSON(notesFile, []);
      notes.push({ text: m[1].trim(), date: new Date().toLocaleString('ru-RU') });
      saveJSON(notesFile, notes);
      ctx.reply('Записал, сэр.');
      return true;
    }
    if (/^(покажи )?(мои )?заметки$/.test(text)) {
      const notes = loadJSON(notesFile, []);
      if (!notes.length) {
        ctx.reply('Заметок пока нет, сэр. Скажите «запиши …», чтобы добавить.');
      } else {
        const list = notes
          .map((n, i) => `${i + 1}. ${n.text}  <i>(${n.date})</i>`)
          .join('\n');
        ctx.reply('<b>Ваши заметки:</b>\n' + list, `У вас ${notes.length} ${plural(notes.length, 'заметка', 'заметки', 'заметок')}, сэр.`);
      }
      return true;
    }
    if (/^(очисти|удали) заметки$/.test(text)) {
      saveJSON(notesFile, []);
      ctx.reply('Заметки очищены, сэр.');
      return true;
    }

    // --- погода ---
    if ((m = text.match(/^погода( в| на)? ?(.*)$/))) {
      return weather(m[2] ? m[2].trim() : '', ctx);
    }

    // --- громкость ---
    if ((m = text.match(/громкость (на )?(\d+)/))) {
      const p = parseInt(m[2], 10);
      ctx.reply(`Ставлю громкость ${p}%, сэр.`);
      await volumeSet(p);
      return true;
    }
    if (/^(громче|прибавь звук|сделай громче)/.test(text)) {
      await volumeUp(5);
      ctx.reply('Прибавил громкость, сэр.');
      return true;
    }
    if (/^(тише|убавь звук|сделай тише)/.test(text)) {
      await volumeDown(5);
      ctx.reply('Убавил громкость, сэр.');
      return true;
    }
    if (/без звука|выключи звук|мьют|замьють/.test(text)) {
      await volumeMute();
      ctx.reply('Звук переключён, сэр.');
      return true;
    }
    if (/включи звук/.test(text)) {
      await volumeMute();
      ctx.reply('Звук переключён, сэр.');
      return true;
    }

    // --- скриншот ---
    if (/скриншот|снимок экрана/.test(text)) {
      return screenshot(ctx);
    }

    // --- система: выключение и т.п. ---
    if (/отмен(а|и) (выключени|перезагрузк)/.test(text)) {
      await run('shutdown /a');
      ctx.reply('Выключение отменено, сэр.');
      return true;
    }
    if (/выключи (компьютер|пк|комп)/.test(text)) {
      ctx.reply('Выключаю компьютер через 20 секунд, сэр. Скажите «отмена выключения», если передумали.');
      await run('shutdown /s /t 20', 'shutdown -h +1');
      return true;
    }
    if (/перезагрузи|перезагрузка/.test(text)) {
      ctx.reply('Перезагружаю через 20 секунд, сэр. «Отмена перезагрузки» — если передумали.');
      await run('shutdown /r /t 20', 'shutdown -r +1');
      return true;
    }
    if (/спящий режим|режим сна|усыпи/.test(text)) {
      ctx.reply('Перевожу компьютер в сон, сэр.');
      await run('rundll32 powrprof.dll,SetSuspendState 0,1,0', 'systemctl suspend');
      return true;
    }
    if (/заблокируй|блокировка/.test(text)) {
      ctx.reply('Блокирую, сэр.');
      await run('rundll32 user32.dll,LockWorkStation');
      return true;
    }
    if (/очисти корзину/.test(text)) {
      await ps('Clear-RecycleBin -Force -ErrorAction SilentlyContinue');
      ctx.reply('Корзина очищена, сэр.');
      return true;
    }

    // --- закрыть программу ---
    if ((m = text.match(/^закрой (.+)$/))) {
      const who = m[1].trim();
      const app = APPS[who];
      if (app && app.kill) {
        await run(`taskkill /im ${app.kill} /f`);
        ctx.reply(`Закрыл ${who}, сэр.`);
      } else {
        ctx.reply(`Не знаю, как закрыть «${who}», сэр.`);
      }
      return true;
    }

    // --- поиск ---
    if ((m = raw.match(/(?:найди в ютубе|поищи в ютубе|ютуб)\s+(.+)/i))) {
      shell.openExternal('https://www.youtube.com/results?search_query=' + encodeURIComponent(m[1].trim()));
      ctx.reply(`Ищу на Ютубе: ${m[1].trim()}`);
      return true;
    }
    if ((m = raw.match(/(?:найди|загугли|поищи|погугли)\s+(.+)/i))) {
      shell.openExternal('https://www.google.com/search?q=' + encodeURIComponent(m[1].trim()));
      ctx.reply(`Ищу в Гугле: ${m[1].trim()}`);
      return true;
    }
    if ((m = raw.match(/включи (?:музыку|песню|трек)\s*(.*)/i))) {
      const q = m[1].trim();
      if (q) {
        shell.openExternal('https://music.youtube.com/search?q=' + encodeURIComponent(q));
        ctx.reply(`Включаю: ${q}`);
      } else {
        shell.openExternal('https://music.yandex.ru');
        ctx.reply('Открываю музыку, сэр.');
      }
      return true;
    }

    // --- информация о системе ---
    if (/^(система|характеристики|инфо о (пк|системе))$/.test(text)) {
      const totalGb = (os.totalmem() / 1073741824).toFixed(1);
      const freeGb = (os.freemem() / 1073741824).toFixed(1);
      const upH = Math.floor(os.uptime() / 3600);
      const upM = Math.floor((os.uptime() % 3600) / 60);
      const info = [
        `<b>Система:</b> ${os.type()} ${os.release()}`,
        `<b>Процессор:</b> ${os.cpus()[0].model.trim()} (${os.cpus().length} потоков)`,
        `<b>Память:</b> свободно ${freeGb} из ${totalGb} ГБ`,
        `<b>Время работы:</b> ${upH} ч ${upM} мин`,
      ].join('\n');
      ctx.reply(info, `Свободно ${freeGb} гигабайт памяти из ${totalGb}. Компьютер работает ${upH} часов ${upM} минут, сэр.`);
      return true;
    }
    if (/мой (ай ?пи|ip)|ip адрес/.test(text)) {
      const nets = os.networkInterfaces();
      const ips = [];
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (net.family === 'IPv4' && !net.internal) ips.push(`${name}: ${net.address}`);
        }
      }
      ctx.reply(ips.length ? '<b>Локальные адреса:</b>\n' + ips.join('\n') : 'Не нашёл сетевых адресов, сэр.');
      return true;
    }

    // --- развлечения ---
    if (/шутк|анекдот|рассмеши/.test(text)) {
      ctx.reply(JOKES[Math.floor(Math.random() * JOKES.length)]);
      return true;
    }
    if (/монетк|орел или решка/.test(text)) {
      ctx.reply(Math.random() < 0.5 ? '🪙 Орёл, сэр!' : '🪙 Решка, сэр!');
      return true;
    }
    if (/кубик|кость/.test(text)) {
      ctx.reply(`🎲 Выпало ${1 + Math.floor(Math.random() * 6)}, сэр.`);
      return true;
    }
    if ((m = text.match(/случайное число от (\d+) до (\d+)/))) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      const r = a + Math.floor(Math.random() * (b - a + 1));
      ctx.reply(`Случайное число: ${r}, сэр.`);
      return true;
    }

    // --- голос ассистента ---
    if (/^(какие( есть)? голоса|голоса|список голосов|покажи голоса)$/.test(text)) {
      const list = window.JarvisTTS.listVoices();
      if (!list.length) {
        ctx.reply('Не вижу ни одного голоса в системе, сэр. Установите их: Параметры → Время и язык → Речь.');
      } else {
        const rows = list
          .map((v, i) => `${i + 1}. ${v.name} (${v.lang})${v.current ? ' — <b>текущий</b>' : ''}`)
          .join('\n');
        ctx.reply(
          '<b>Доступные голоса:</b>\n' + rows +
            '\n\nСкажите «<b>голос 2</b>» или «<b>голос павел</b>», чтобы переключить.' +
            '\nБольше голосов: Параметры → Время и язык → Речь → «Добавить голоса».',
          `У меня ${list.length} ${plural(list.length, 'голос', 'голоса', 'голосов')}, сэр. Выберите любой.`
        );
      }
      return true;
    }
    if (/^(смени|поменяй|измени|другой) голос$/.test(text)) {
      const name = window.JarvisTTS.cycleVoice();
      if (name) ctx.reply(`Теперь я говорю голосом «${name}», сэр. Как вам?`);
      else ctx.reply('Не нашёл других голосов, сэр.');
      return true;
    }
    if ((m = text.match(/^голос ((?!ассистента).+)$/))) {
      const name = window.JarvisTTS.setVoiceByQuery(m[1]);
      if (name) ctx.reply(`Готово, сэр. Мой новый голос — «${name}».`);
      else ctx.reply(`Не нашёл голос «${m[1]}», сэр. Скажите «голоса» — покажу список.`);
      return true;
    }
    if (/^говори (по)?быстрее$/.test(text)) {
      const r = window.JarvisTTS.setRate(window.JarvisTTS.rate + 0.15);
      ctx.reply(`Ускорился до ${r.toFixed(2)}, сэр.`);
      return true;
    }
    if (/^говори (по)?медленнее$/.test(text)) {
      const r = window.JarvisTTS.setRate(window.JarvisTTS.rate - 0.15);
      ctx.reply(`Говорю медленнее, темп ${r.toFixed(2)}, сэр.`);
      return true;
    }
    if (/^говори (нормально|обычно)$/.test(text)) {
      window.JarvisTTS.setRate(1.05);
      ctx.reply('Вернул обычный темп речи, сэр.');
      return true;
    }

    // --- свои команды ---
    if (/^(мои команды|редактируй команды|настрой команды)$/.test(text)) {
      const file = ensureCustomCommands(ctx.paths.userData);
      shell.openPath(file);
      ctx.reply('Открываю файл ваших команд, сэр. После правки сохраните его — и просто скажите «открой …».');
      return true;
    }

    // --- открыть / запустить ---
    if ((m = text.match(/^(?:открой|запусти|включи|перейди на)(?: сайт| приложение| программу| папку)? (.+)$/))) {
      return openTarget(m[1], ctx);
    }

    // --- не поняли ---
    ctx.reply(
      `Не понял команду «${raw.trim()}», сэр. Скажите «помощь» — покажу, что умею. Или «найди ${raw.trim()}» — поищу в интернете.`
    );
    return true;
  }

  window.JarvisCommands = { handle, HELP_TEXT, ensureCustomCommands };
})();
