const { ipcRenderer } = require('electron');

// DOM elements
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const voiceBtn = document.getElementById('voice-btn');
const messagesDiv = document.getElementById('messages');
const historyList = document.getElementById('history-list');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const quickActions = document.getElementById('quick-actions');

// State
let isListening = false;
let isWakeListening = false;
let recognition;
let wakeRecognition;
let currentGame = null;
let settings = {};
let isSpeaking = false;
let speechSynthesis = window.speechSynthesis;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Load settings
  settings = await ipcRenderer.invoke('get-settings');
  populateSettings();

  // Load history
  const history = await ipcRenderer.invoke('get-session-history');
  history.forEach(item => addToHistory(item.message));

  // Setup voice recognition
  if ('webkitSpeechRecognition' in window) {
    recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      messageInput.value = transcript;
      sendMessage(transcript);
    };

    recognition.onend = () => {
      isListening = false;
      voiceBtn.textContent = '🎤';
    };

    // Wake word recognition
    if (settings.wakeWordEnabled) {
      wakeRecognition = new webkitSpeechRecognition();
      wakeRecognition.continuous = true;
      wakeRecognition.interimResults = true;
      wakeRecognition.lang = 'en-US';

      wakeRecognition.onresult = (event) => {
        const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase();
        if (transcript.includes('hey casa')) {
          if (isSpeaking) {
            speechSynthesis.cancel();
            isSpeaking = false;
          }
          recognition.start();
          isListening = true;
          voiceBtn.textContent = '🛑';
          wakeRecognition.stop();
        }
      };

      wakeRecognition.onend = () => {
        if (settings.wakeWordEnabled) {
          wakeRecognition.start();
        }
      };

      wakeRecognition.start();
      isWakeListening = true;
    }
  }

  // Add detect game button
  const detectBtn = document.createElement('button');
  detectBtn.id = 'detect-game-btn';
  detectBtn.textContent = 'Detect Game';
  document.querySelector('header').appendChild(detectBtn);

  detectBtn.addEventListener('click', async () => {
    currentGame = await ipcRenderer.invoke('detect-game');
    addMessage('system', `Game detected: ${currentGame}`);
  });

  // Quick actions
  quickActions.addEventListener('click', (e) => {
    if (e.target.classList.contains('action-btn')) {
      const action = e.target.textContent;
      sendMessage(`${action} for ${currentGame || 'general'}`);
    }
  });

  // Listen for overlay messages
  ipcRenderer.on('receive-message', (event, message) => {
    sendMessage(message);
  });
});

// Event listeners
sendBtn.addEventListener('click', () => {
  const message = messageInput.value.trim();
  if (message) {
    sendMessage(message);
    messageInput.value = '';
  }
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    sendBtn.click();
  }
  if (isSpeaking) {
    speechSynthesis.cancel();
    isSpeaking = false;
  }
});

voiceBtn.addEventListener('click', () => {
  if (isListening) {
    recognition.stop();
  } else {
    recognition.start();
    isListening = true;
    voiceBtn.textContent = '🛑';
  }
});

settingsBtn.addEventListener('click', () => {
  settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
});

// Functions
async function sendMessage(message) {
  // Add to UI
  addMessage('user', message);

  // Send to AI
  const response = await ipcRenderer.invoke('send-chat', message, currentGame);

  // Add AI response
  addMessage('ai', response);

  // Speak response
  speak(response);

  // Add to history
  ipcRenderer.invoke('add-to-history', message);
}

function addMessage(sender, text) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${sender}`;
  msgDiv.textContent = text;
  messagesDiv.appendChild(msgDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function addToHistory(message) {
  const li = document.createElement('li');
  li.textContent = message;
  li.addEventListener('click', () => {
    messageInput.value = message;
  });
  historyList.appendChild(li);
}

function populateSettings() {
  settingsPanel.innerHTML = `
    <h2>Settings</h2>
    <label>Username: <input id="username" value="${settings.username || ''}"></label><br>
    <label>Voice Gender: 
      <select id="voiceGender">
        <option value="female" ${settings.voiceGender === 'female' ? 'selected' : ''}>Female</option>
        <option value="male" ${settings.voiceGender === 'male' ? 'selected' : ''}>Male</option>
      </select>
    </label><br>
    <label>Speak Speed: <input id="speakSpeed" type="range" min="0.5" max="2" step="0.1" value="${settings.speakSpeed || 1}"></label><br>
    <label>Volume: <input id="volume" type="range" min="0" max="1" step="0.1" value="${settings.volume || 1}"></label><br>
    <label>Wake Word Enabled: <input id="wakeWordEnabled" type="checkbox" ${settings.wakeWordEnabled ? 'checked' : ''}></label><br>
    <label>Overlay Hotkey: <input id="overlayHotkey" value="${settings.overlayHotkey || 'CommandOrControl+Shift+G'}"></label><br>
    <label>Overlay Opacity: <input id="overlayOpacity" type="range" min="0.1" max="1" step="0.1" value="${settings.overlayOpacity || 0.8}"></label><br>
    <label>Capture Rate: <input id="captureRate" type="number" value="${settings.captureRate || 30}"></label><br>
    <label>Anthropic API Key: <input id="apiKey" type="password" placeholder="Enter your API key"></label><br>
    <button id="save-settings">Save</button>
  `;

  document.getElementById('save-settings').addEventListener('click', saveSettings);
}

async function saveSettings() {
  const newSettings = {
    username: document.getElementById('username').value,
    voiceGender: document.getElementById('voiceGender').value,
    speakSpeed: parseFloat(document.getElementById('speakSpeed').value),
    volume: parseFloat(document.getElementById('volume').value),
    wakeWordEnabled: document.getElementById('wakeWordEnabled').checked,
    overlayHotkey: document.getElementById('overlayHotkey').value,
    overlayOpacity: parseFloat(document.getElementById('overlayOpacity').value),
    captureRate: parseInt(document.getElementById('captureRate').value)
  };
  const apiKey = document.getElementById('apiKey').value;
  if (apiKey) {
    await ipcRenderer.invoke('save-api-key', apiKey);
  }
  await ipcRenderer.invoke('save-settings', newSettings);
  settings = newSettings;
  settingsPanel.style.display = 'none';
  // Restart wake if changed
  if (wakeRecognition) {
    wakeRecognition.stop();
    if (settings.wakeWordEnabled) {
      wakeRecognition.start();
    }
  }
}

// TTS placeholder
function speak(text) {
  if ('speechSynthesis' in window && settings) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = settings.speakSpeed || 1;
    utterance.volume = settings.volume || 1;
    utterance.voice = speechSynthesis.getVoices().find(v => v.name.includes(settings.voiceGender === 'male' ? 'Male' : 'Female')) || null;
    utterance.onstart = () => { isSpeaking = true; };
    utterance.onend = () => { isSpeaking = false; };
    speechSynthesis.speak(utterance);
  }
}