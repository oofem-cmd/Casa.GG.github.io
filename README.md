# CasaGG v1.0 - Gaming Assistant

CasaGG is your full gaming assistant app powered by AI.

## Features

- **AI-Powered Chat**: Powered by Claude Sonnet via the Anthropic API with full multi-turn conversation memory and game-context awareness.
- **Voice Ask**: Click the mic button to ask a question by voice using the Web Speech API.
- **Hey Casa Wake Word**: Continuous background listener; saying "Hey Casa" stops any active speech and starts listening for your question.
- **Stop on Input**: Typing or hitting Stop while Casa is speaking cancels it immediately.
- **Text-to-Speech Responses**: Casa reads answers aloud with adjustable speed, volume, and male/female voice.
- **Game Detection**: Click "Detect Game" to simulate selecting a game window; detected game is passed as context to every answer.
- **Picture-in-Picture Overlay**: Draggable floating overlay with its own input — pin it over your game.
- **Customizable Hotkey**: Ctrl+Shift+G toggles the overlay by default; rebindable in Settings.
- **Settings Panel**: Username, voice gender, speak speed, volume, wake word toggle, overlay hotkey, opacity, capture rate.
- **Timezone Detection**: Auto-detects your local timezone and injects it into every AI query for live service game events.
- **Session History**: Sidebar tracks recent questions for quick replay.
- **Quick Action chips**: One-tap boss help, build advice, lore, collectibles, etc.

## Installation

1. Install Node.js from https://nodejs.org/
2. Clone or download this repository.
3. Run `npm install` to install dependencies.
4. Set your Anthropic API key in the Settings panel.
5. Run `npm start` to launch the app.

## Usage

- Open the app.
- Set your API key in Settings.
- Ask questions via text or voice.
- Use the overlay by pressing Ctrl+Shift+G.
- Detect games and get contextual answers.

## Build a Windows EXE

1. Install Node.js and dependencies: `npm install`
2. Run the build command: `npm run dist`
3. Find the installer in the `dist` folder, such as `CasaGG Setup 1.0.0.exe`

> If you want a downloadable installer, distribute the EXE file from the `dist` folder.

## Development

- Main process: `main.js`
- Renderer: `index.html`, `renderer.js`
- Overlay: `overlay.html`, `overlay.js`
- Styles: `styles.css`, `overlay.css`

## Requirements

- Node.js
- Anthropic API key