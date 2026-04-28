// ═══════════════════════════════════════════════════════════════════
//  CasaGG — Overwolf Background Controller
//  Handles: game detection, live events, window management, hotkeys
// ═══════════════════════════════════════════════════════════════════

'use strict';

// ── State ────────────────────────────────────────────────────────────
let _mainWindowId   = null;
let _overlayWindowId = null;
let _mapWindowId    = null;
let _currentGame    = null;
let _currentGameId  = null;
let _overlayOpen    = false;
let _eventsReady    = false;
let _listenersAdded = false;

// ── Public API (called from other windows via getMainWindow()) ────────
window.CasaBackground = {
  toggleOverlay,
  showMap,
  hideMap,
  getGameInfo: () => ({ name: _currentGame, id: _currentGameId }),
  isOverlayOpen: () => _overlayOpen,

  // Called by main window to relay answer to overlay
  relayAnswerToOverlay(answer) {
    _sendToOverlay('new-answer', { answer });
  },
  relayThinkingToOverlay(msg) {
    _sendToOverlay('overlay-thinking', { msg });
  }
};

// ── Init ──────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  _initWindows();
  _setupGameDetection();
  _setupHotkeys();
  console.log('[CasaGG] Background controller ready');
});

function _initWindows() {
  // Open the main window immediately
  overwolf.windows.obtainDeclaredWindow('main', result => {
    if (result.success) {
      _mainWindowId = result.window.id;
      overwolf.windows.restore(_mainWindowId, () => {});
    }
  });

  // Pre-obtain overlay/map IDs (don't show yet)
  overwolf.windows.obtainDeclaredWindow('overlay', result => {
    if (result.success) _overlayWindowId = result.window.id;
  });
  overwolf.windows.obtainDeclaredWindow('map', result => {
    if (result.success) _mapWindowId = result.window.id;
  });
}

// ── Game detection ─────────────────────────────────────────────────────
function _setupGameDetection() {
  overwolf.games.onGameLaunched.addListener(_handleGameLaunch);
  overwolf.games.onGameClosed.addListener(_handleGameClose);

  // Check if already running when extension starts
  overwolf.games.getRunningGameInfo(result => {
    if (result && result.isRunning && result.gameInfo) {
      _handleGameLaunch(result.gameInfo);
    }
  });
}

function _handleGameLaunch(gameInfo) {
  _currentGame   = gameInfo.displayName || gameInfo.title || 'Unknown Game';
  // Strip the 2-digit running-state suffix Overwolf appends to game IDs
  _currentGameId = Math.floor((gameInfo.id || 0) / 10);

  console.log('[CasaGG] Game launched:', _currentGame, '| ID:', _currentGameId);

  _registerGameEvents();
  _sendToMain('game-launched', { gameName: _currentGame, gameId: _currentGameId });
}

function _handleGameClose(gameInfo) {
  console.log('[CasaGG] Game closed:', gameInfo.displayName || gameInfo.title);
  _currentGame   = null;
  _currentGameId = null;
  _eventsReady   = false;

  _sendToMain('game-closed', {});

  // Hide overlays when game exits
  if (_overlayWindowId) overwolf.windows.hide(_overlayWindowId, () => {});
  if (_mapWindowId)     overwolf.windows.hide(_mapWindowId,     () => {});
  _overlayOpen = false;
}

// ── Live game events ──────────────────────────────────────────────────
function _onNewEvents(info) {
  const events = info.events || [];
  _sendToMain('game-event',    { events });
  _sendToOverlay('game-event', { events });
  _sendToMap('game-event',     { events });
}

function _onInfoUpdates(info) {
  _sendToMain('game-info-update', { info: info.info });
  _sendToMap('game-info-update',  { info: info.info });
}

function _registerGameEvents() {
  // Add listeners only once; re-register required features each game launch
  if (!_listenersAdded) {
    overwolf.games.events.onNewEvents.addListener(_onNewEvents);
    overwolf.games.events.onInfoUpdates2.addListener(_onInfoUpdates);
    _listenersAdded = true;
  }

  _eventsReady = false;
  const features = [
    'game_info', 'match_info', 'kill', 'death', 'location',
    'inventory', 'me', 'live_client_data', 'gpm_tpm', 'hero_abilities', 'player'
  ];

  overwolf.games.events.setRequiredFeatures(features, result => {
    _eventsReady = true;
    const supported = (result && result.supportedFeatures) || [];
    console.log('[CasaGG] Game events ready. Supported:', supported.join(', ') || 'none');
    _sendToMain('events-ready', { features: supported });
  });
}

// ── Hotkeys ───────────────────────────────────────────────────────────
function _setupHotkeys() {
  overwolf.settings.hotkeys.onPressed.addListener(hotkey => {
    if (hotkey.name === 'toggle_overlay') toggleOverlay();
    if (hotkey.name === 'voice_ask')      _sendToMain('voice-ask-trigger', {});
  });
}

// ── Window management ─────────────────────────────────────────────────
function toggleOverlay() {
  const _doToggle = winId => {
    overwolf.windows.getWindowState(winId, stateResult => {
      if (!stateResult.success) {
        overwolf.windows.restore(winId, () => { _overlayOpen = true; _sendToMain('overlay-state', { open: true }); });
        return;
      }
      const s = stateResult.window_state_ex;
      if (s === 'normal' || s === 'maximized') {
        overwolf.windows.hide(winId, () => { _overlayOpen = false; _sendToMain('overlay-state', { open: false }); });
      } else {
        overwolf.windows.restore(winId, () => { _overlayOpen = true; _sendToMain('overlay-state', { open: true }); });
      }
    });
  };

  if (_overlayWindowId) {
    _doToggle(_overlayWindowId);
  } else {
    overwolf.windows.obtainDeclaredWindow('overlay', result => {
      if (result.success) {
        _overlayWindowId = result.window.id;
        _doToggle(_overlayWindowId);
      }
    });
  }
}

function showMap() {
  const _doShow = winId => {
    overwolf.windows.restore(winId, () => {});
  };
  if (_mapWindowId) {
    _doShow(_mapWindowId);
  } else {
    overwolf.windows.obtainDeclaredWindow('map', result => {
      if (result.success) { _mapWindowId = result.window.id; _doShow(_mapWindowId); }
    });
  }
}

function hideMap() {
  if (_mapWindowId) overwolf.windows.hide(_mapWindowId, () => {});
}

// ── Message relay ─────────────────────────────────────────────────────
// Incoming from any window → relay as needed
overwolf.windows.onMessageReceived.addListener(msg => {
  const type    = msg.id;
  const content = msg.content || {};

  switch (type) {
    case 'overlay-ask':
      _sendToMain('ask-from-overlay', { question: content.question });
      break;
    case 'update-overlay':
      _sendToOverlay('new-answer', { answer: content.answer });
      break;
    case 'overlay-status':
      _sendToOverlay('overlay-thinking', { msg: content.msg });
      break;
    case 'toggle-overlay':
      toggleOverlay();
      break;
    case 'hide-overlay':
      if (_overlayWindowId) {
        overwolf.windows.hide(_overlayWindowId, () => {
          _overlayOpen = false;
          _sendToMain('overlay-state', { open: false });
        });
      }
      break;
    case 'show-map':
      showMap();
      break;
    case 'hide-map':
      hideMap();
      break;
  }
});

// ── Helpers ───────────────────────────────────────────────────────────
function _sendToWindow(winId, msgType, data) {
  if (!winId) return;
  overwolf.windows.sendMessage(winId, msgType, data, () => {});
}

function _sendToMain(type, data) {
  if (!_mainWindowId) {
    overwolf.windows.obtainDeclaredWindow('main', r => {
      if (r.success) { _mainWindowId = r.window.id; _sendToWindow(_mainWindowId, type, data); }
    });
    return;
  }
  _sendToWindow(_mainWindowId, type, data);
}

function _sendToOverlay(type, data) {
  if (!_overlayWindowId) return;
  _sendToWindow(_overlayWindowId, type, data);
}

function _sendToMap(type, data) {
  if (!_mapWindowId) return;
  _sendToWindow(_mapWindowId, type, data);
}
