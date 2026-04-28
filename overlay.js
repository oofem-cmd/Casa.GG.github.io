const { ipcRenderer } = require('electron');

const overlayInput = document.getElementById('overlay-input');
const overlaySend = document.getElementById('overlay-send');

// Make overlay draggable
let isDragging = false;
let offsetX, offsetY;

document.addEventListener('mousedown', (e) => {
  if (e.target === document.getElementById('overlay')) {
    isDragging = true;
    offsetX = e.clientX - window.screenX;
    offsetY = e.clientY - window.screenY;
  }
});

document.addEventListener('mousemove', (e) => {
  if (isDragging) {
    window.moveTo(e.screenX - offsetX, e.screenY - offsetY);
  }
});

document.addEventListener('mouseup', () => {
  isDragging = false;
});

// Send message
overlaySend.addEventListener('click', () => {
  const message = overlayInput.value.trim();
  if (message) {
    ipcRenderer.send('overlay-message', message);
    overlayInput.value = '';
  }
});

overlayInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    overlaySend.click();
  }
});