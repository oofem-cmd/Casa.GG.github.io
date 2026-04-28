const { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Tray, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const Store    = require('electron-store');
const https    = require('https');
const path     = require('path');
const { spawn } = require('child_process');

const { ANTHROPIC_KEY, GROQ_KEY, EMAILJS_SERVICE, EMAILJS_TEMPLATE, EMAILJS_KEY, EMAILJS_PRIVATE } = require('./secrets');

const _sessionCache = {};
const SESSION_MAX   = 500;

const store = new Store();
// Must be called before app.whenReady()
if (store.get('userSettings', {}).disableHwAccel) app.disableHardwareAcceleration();
app.setAppUserModelId('com.casagg.casagg');

// Single-instance lock — if already running, focus that window and quit this one
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

let mainWindow;
let overlayWindow;
let tray       = null;
let lastAnswer = '';
let speechProc = null;

const ICON = path.join(__dirname, 'assets', 'casaorangegg.ico');

// ── Main window ──────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    icon: ICON,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    title: 'CasaGG — Gaming Assistant'
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });
  mainWindow.webContents.session.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media';
  });
  mainWindow.loadFile('index.html');
  mainWindow.webContents.once('did-finish-load', () => {
    windowLoaded = true;
    flushSpeechQueue(); // deliver any events the bridge emitted before the page was ready
  });
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.control && input.shift && input.key === 'D') mainWindow.webContents.openDevTools();
  });
  // Minimize → hide to tray (background). Close → actually quit.
  mainWindow.on('minimize', () => {
    if (store.get('userSettings', {}).runInBackground !== false) {
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; windowLoaded = false; });
}

// ── System tray ───────────────────────────────────────────────────────────────
function createTray() {
  if (tray && !tray.isDestroyed()) return;
  tray = new Tray(ICON);
  tray.setToolTip('CasaGG — Gaming Assistant');
  const menu = Menu.buildFromTemplate([
    { label: 'Open CasaGG', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else createMainWindow(); } },
    { type: 'separator' },
    { label: 'Quit CasaGG', click: () => { app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else createMainWindow(); });
}

// ── Overlay window (always-on-top, transparent, frameless) ───────────────────
function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show();
    overlayWindow.focus();
    return;
  }
  overlayWindow = new BrowserWindow({
    width: 370,
    height: 290,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minWidth: 280,
    minHeight: 160,
    icon: ICON,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  overlayWindow.loadFile('overlay.html');
  const savedOpacity = (store.get('userSettings', {}).overlayOpacity ?? 90) / 100;
  overlayWindow.setOpacity(Math.max(0.1, Math.min(1, savedOpacity)));
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Replay the last answer so opening the overlay always shows something useful
  overlayWindow.webContents.once('did-finish-load', () => {
    if (lastAnswer) overlayWindow.webContents.send('new-answer', lastAnswer);
  });
  overlayWindow.on('closed', () => { overlayWindow = null; });
}

function toggleOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
    overlayWindow.hide();
    mainWindow?.webContents.send('overlay-state', false);
  } else {
    createOverlayWindow();
    mainWindow?.webContents.send('overlay-state', true);
  }
}

// ── Global hotkey ────────────────────────────────────────────────────────────
function toAccelerator(hotkey) {
  return hotkey
    .replace(/\bCtrl\b/gi,    'CommandOrControl')
    .replace(/\bControl\b/gi, 'CommandOrControl')
    .replace(/\bMeta\b/gi,    'Super')
    .replace(/\bWindows\b/gi, 'Super');
}

function registerGlobalHotkey(hotkey) {
  globalShortcut.unregisterAll();
  try {
    globalShortcut.register(toAccelerator(hotkey), toggleOverlay);
  } catch (e) {
    console.warn('Hotkey register failed:', e.message);
  }
}

// ── Windows Speech API bridge ────────────────────────────────────────────────
let windowLoaded = false;
let speechEventQueue = [];

function flushSpeechQueue() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  speechEventQueue.forEach(msg => mainWindow.webContents.send('speech-event', msg));
  speechEventQueue = [];
}

function sendSpeechEvent(msg) {
  console.log('[speech]', msg.event, msg.text || '');
  if (windowLoaded && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('speech-event', msg);
  } else {
    speechEventQueue.push(msg); // hold until renderer is ready
  }
}

function speechExePath() {
  const fs   = require('fs');
  const prod = path.join(process.resourcesPath || '', 'speech_bridge.exe');
  const dev  = path.join(__dirname, 'assets', 'speech_bridge.exe');
  const chosen = fs.existsSync(prod) ? prod : dev;
  console.log('[speech] exe path:', chosen, 'exists:', fs.existsSync(chosen));
  return chosen;
}

function sendToSpeech(cmd) {
  if (!speechProc) return;
  try { speechProc.stdin.write(cmd + '\n'); } catch (e) { console.warn('[speech] write error:', e.message); }
}

function startSpeechBridge() {
  if (speechProc) return;
  try {
    const exePath = speechExePath();
    speechProc = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    let buf = '';
    speechProc.stdout.on('data', chunk => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try { sendSpeechEvent(JSON.parse(line)); } catch {}
      }
    });

    speechProc.stderr.on('data', d => console.warn('[speech-err]', d.toString().trim()));
    speechProc.on('error', e => console.error('[speech] spawn error:', e.message));

    speechProc.on('exit', (code) => {
      console.log('[speech] process exited, code:', code);
      speechProc = null;
      if (mainWindow && !mainWindow.isDestroyed()) setTimeout(startSpeechBridge, 3000);
    });

    console.log('[speech] bridge started, pid:', speechProc.pid);
  } catch (e) {
    console.error('[speech] failed to start:', e.message);
  }
}

ipcMain.on('speech-cmd', (_e, cmd) => sendToSpeech(cmd));

// Renderer can check if bridge is alive
ipcMain.handle('speech-status', () => ({ alive: !!speechProc, pid: speechProc?.pid ?? null }));

// ── App lifecycle ────────────────────────────────────────────────────────────
// ── Auto-updater ─────────────────────────────────────────────────────────────
autoUpdater.autoDownload        = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', info => {
  const notes = typeof info.releaseNotes === 'string'
    ? info.releaseNotes
    : (Array.isArray(info.releaseNotes) ? info.releaseNotes.map(n => n.note || n).join(' ') : '');
  mainWindow?.webContents.send('update-available', info.version, notes);
});
autoUpdater.on('update-downloaded',    ()  => { mainWindow?.webContents.send('update-downloaded'); });
autoUpdater.on('update-not-available', ()  => { mainWindow?.webContents.send('update-not-available'); });
autoUpdater.on('error',                e   => { mainWindow?.webContents.send('update-error', e.message); });

ipcMain.on('install-update', () => autoUpdater.quitAndInstall());

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) return { status: 'dev' };
  try {
    await autoUpdater.checkForUpdates();
    return { status: 'checking' };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
});

app.whenReady().then(() => {
  createMainWindow();
  createTray();
  registerGlobalHotkey(store.get('overlayHotkey', 'Ctrl+Shift+G'));
  startSpeechBridge();
  // Apply saved login-item setting
  const loginVal = store.get('userSettings', {}).startOnBoot;
  if (typeof loginVal === 'boolean') app.setLoginItemSettings({ openAtLogin: loginVal });
  // Check for updates 5 s after launch so it never delays startup
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdatesAndNotify(), 5000);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (speechProc) { try { speechProc.stdin.write('exit\n'); } catch {} }
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate',          () => { if (!mainWindow) createMainWindow(); });

// ── IPC: API key ─────────────────────────────────────────────────────────────
ipcMain.handle('get-api-key',  ()       => store.get('apiKey', ''));
ipcMain.handle('save-api-key', (_e, k)  => store.set('apiKey', k));

// ── IPC: Hotkey ───────────────────────────────────────────────────────────────
ipcMain.handle('save-overlay-hotkey', (_e, hk) => {
  store.set('overlayHotkey', hk);
  registerGlobalHotkey(hk);
});

// ── IPC: All settings ─────────────────────────────────────────────────────────
ipcMain.handle('get-settings', () => store.get('userSettings', {}));
ipcMain.handle('save-settings', (_e, s) => {
  store.set('userSettings', s);
  if (s.overlayHotkey) {
    store.set('overlayHotkey', s.overlayHotkey);
    registerGlobalHotkey(s.overlayHotkey);
  }
});

// ── IPC: Overlay opacity ──────────────────────────────────────────────────────
ipcMain.handle('set-overlay-opacity', (_e, pct) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setOpacity(Math.max(0.1, Math.min(1, pct / 100)));
  }
});

// ── IPC: Overlay control ──────────────────────────────────────────────────────
ipcMain.handle('toggle-overlay-window', () => {
  toggleOverlay();
  return !!(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible());
});

// Push a new AI answer into the overlay
ipcMain.handle('update-overlay', (_e, answer) => {
  lastAnswer = answer;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('new-answer', answer);
  }
});

// Show thinking state in overlay (separate from answer so it uses the wave animation)
ipcMain.handle('overlay-status', (_e, msg) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay-thinking', msg || 'Thinking…');
  }
});

// Overlay asks a question → forward to main window
ipcMain.on('overlay-ask', (_e, question) => {
  mainWindow?.webContents.send('ask-from-overlay', question);
});

// Overlay close button
ipcMain.on('hide-overlay', () => {
  overlayWindow?.hide();
  mainWindow?.webContents.send('overlay-state', false);
});

// ── IPC: Window enumeration ───────────────────────────────────────────────────
ipcMain.handle('get-windows', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 320, height: 180 }
    });
    return sources
      .filter(s => {
        const n = (s.name ?? '').trim();
        return n && n !== 'CasaGG — Gaming Assistant' && n !== 'Electron';
      })
      .map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
  } catch (e) {
    console.error('get-windows:', e.message);
    return [];
  }
});

// ── IPC: Screen capture ───────────────────────────────────────────────────────
ipcMain.handle('capture-window', async (_e, sourceId, capWidth, capHeight) => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: capWidth || 640, height: capHeight || 360 }
    });
    const src = sourceId
      ? sources.find(s => s.id === sourceId)
      : sources.find(s => s.name && !s.name.includes('CasaGG'));
    return src?.thumbnail.toDataURL() ?? null;
  } catch (e) {
    console.error('capture-window:', e.message);
    return null;
  }
});

// ── IPC: Web search ───────────────────────────────────────────────────────────
ipcMain.handle('web-search', (_e, query) => {
  return new Promise(resolve => {
    const options = {
      hostname: 'html.duckduckgo.com',
      path: '/html/?q=' + encodeURIComponent(query) + '&kl=us-en',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 9000
    };
    const req = https.request(options, res => {
      if (res.statusCode === 301 || res.statusCode === 302) { resolve([]); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(parseDDG(Buffer.concat(chunks).toString('utf8'))); }
        catch { resolve([]); }
      });
    });
    req.on('error',   () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.end();
  });
});

function parseDDG(html) {
  const results = [];
  const titleRe   = /<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const links = [];
  let m;
  while ((m = titleRe.exec(html)) !== null && links.length < 5) {
    let url = m[1];
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    const title = m[2].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#x27;/g,"'").trim();
    if (title) links.push({ url, title });
  }
  const snippets = [];
  while ((m = snippetRe.exec(html)) !== null && snippets.length < 5) {
    const s = m[1].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#x27;/g,"'").replace(/&quot;/g,'"').trim();
    if (s) snippets.push(s);
  }
  for (let i = 0; i < Math.min(links.length, snippets.length, 4); i++) {
    results.push({ url: links[i].url, title: links[i].title, snippet: snippets[i] });
  }
  return results;
}

// ── IPC: Login item (start on boot) ──────────────────────────────────────────
ipcMain.handle('get-login-item',  ()          => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('set-login-item',  (_e, val)   => { app.setLoginItemSettings({ openAtLogin: !!val }); });

// ── IPC: Background mode (hide-to-tray vs quit) ───────────────────────────────
ipcMain.handle('set-run-background', (_e, val) => {
  const s = store.get('userSettings', {});
  store.set('userSettings', { ...s, runInBackground: !!val });
});

// ── Local Game Knowledge Base ─────────────────────────────────────────────────
// Add Q&A per game here. Key = game name slug (lowercase, spaces → underscores).
// Questions are matched by keyword similarity (Jaccard ≥ 0.45).
const GAME_KB = {
  // Example — uncomment and fill in when you add a game:
  // 'elden_ring': [
  //   { q: 'how do i level up', a: 'Visit any Site of Grace and choose "Level Up" from the menu…' },
  // ],
};

const KB_STOP = new Set([
  'a','an','the','is','are','was','were','do','does','did','how','what','where',
  'when','why','who','which','can','could','should','would','will','to','of','in',
  'on','at','for','with','about','i','my','me','you','your','it','its','this',
  'that','there','here','and','or','but','if','then','so','get','find','use','make'
]);

function kbWords(q) {
  return (q||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w => w.length > 2 && !KB_STOP.has(w));
}

function kbScore(a, b) {
  const sa = new Set(a), sb = new Set(b);
  const inter = [...sa].filter(x => sb.has(x)).length;
  const union = new Set([...sa,...sb]).size;
  return union ? inter / union : 0;
}

// ── Anthropic API helper ──────────────────────────────────────────────────────
function callAnthropic(system, messages, maxTokens) {
  return new Promise(resolve => {
    const body = Buffer.from(JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: maxTokens || 1200,
      system,
      messages
    }));
    const req = https.request({
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length':    body.length
      },
      timeout: 60000
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (data.error) resolve({ ok:false, error:data.error.message });
          else resolve({ ok:true, data });
        } catch { resolve({ ok:false, error:'Parse error' }); }
      });
    });
    req.on('error',   e => resolve({ ok:false, error:e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok:false, error:'Timeout' }); });
    req.write(body);
    req.end();
  });
}

// ── IPC: Claude chat — session cache → local KB → Anthropic API ──────────────
ipcMain.handle('claude-chat', async (_e, { system, messages, maxTokens, game }) => {
  const last = messages?.[messages.length - 1];
  const question = typeof last?.content === 'string'
    ? last.content
    : (Array.isArray(last?.content) ? (last.content.find(c => c.type === 'text')?.text || '') : '');
  const cacheKey = `${game || 'general'}:${question.trim().toLowerCase()}`;

  // Layer 1: session cache (instant, same session)
  if (_sessionCache[cacheKey]) {
    return { ok:true, data:{ content:[{ text:_sessionCache[cacheKey] }] }, source:'session' };
  }

  // Layer 2: local hardcoded game KB (shipped with the app)
  if (game && question) {
    const slug    = game.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const entries = GAME_KB[slug] || [];
    if (entries.length) {
      const qw = kbWords(question);
      let best = null, top = 0;
      for (const e of entries) {
        const sc = kbScore(qw, kbWords(e.q));
        if (sc > top) { top = sc; best = e; }
      }
      if (top >= 0.45 && best?.a) {
        if (Object.keys(_sessionCache).length < SESSION_MAX) _sessionCache[cacheKey] = best.a;
        return { ok:true, data:{ content:[{ text:best.a }] }, source:'local' };
      }
    }
  }

  // Layer 3: Anthropic API
  const result = await callAnthropic(system, messages, maxTokens);
  if (result.ok && question) {
    const reply = result.data.content?.[0]?.text;
    if (reply && Object.keys(_sessionCache).length < SESSION_MAX) _sessionCache[cacheKey] = reply;
  }
  return { ...result, source: 'api' };
});

// ── IPC: Game request (EmailJS) ───────────────────────────────────────────────

ipcMain.handle('submit-game-request', async (_e, gameTitle, questions, fromName, fromEmail) => {
  return new Promise(resolve => {
    const body = Buffer.from(JSON.stringify({
      service_id:      EMAILJS_SERVICE,
      template_id:     EMAILJS_TEMPLATE,
      user_id:         EMAILJS_KEY,
      accessToken:     EMAILJS_PRIVATE,
      template_params: {
        to_email:   'CasaGGDev@gmail.com',
        from_email: fromEmail  || '',
        from_name:  fromName   || 'Anonymous',
        game_title: gameTitle  || 'Unknown',
        questions:  questions  || 'No questions provided'
      }
    }));
    const req = https.request({
      hostname: 'api.emailjs.com',
      path:     '/api/v1.0/email/send',
      method:   'POST',
      headers:  { 'Content-Type':'application/json', 'Content-Length':body.length },
      timeout:  15000
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString().trim();
        if (res.statusCode === 200) {
          resolve({ ok: true });
        } else {
          resolve({ ok: false, error: `EmailJS ${res.statusCode}: ${text}` });
        }
      });
    });
    req.on('error',   e => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Request timed out' }); });
    req.write(body);
    req.end();
  });
});

// ── IPC: Groq Whisper transcription ──────────────────────────────────────────
ipcMain.handle('transcribe-audio', async (_e, audioArray) => {
  if (!GROQ_KEY || !audioArray || !audioArray.length) return '';
  try {
    const audioBuf  = Buffer.from(audioArray);
    const boundary  = 'CasaGGWhisper' + Date.now();
    const head      = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n`
    );
    const tail      = Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo` +
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen` +
      `\r\n--${boundary}--\r\n`
    );
    const body = Buffer.concat([head, audioBuf, tail]);

    return await new Promise(resolve => {
      const req = https.request({
        hostname: 'api.groq.com',
        path:     '/openai/v1/audio/transcriptions',
        method:   'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_KEY}`,
          'Content-Type':  `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        },
        timeout: 30000
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString()).text || ''); }
          catch { resolve(''); }
        });
      });
      req.on('error',   () => resolve(''));
      req.on('timeout', () => { req.destroy(); resolve(''); });
      req.write(body);
      req.end();
    });
  } catch { return ''; }
});
