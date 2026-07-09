# ManusAgent

A local AI agent with desktop UI, skill forging, and gamification.

## Features

- **Chat** with AI models via OpenRouter + Gemini
- **Forge new skills** - AI writes Python tools at runtime
- **Gamification** - XP, levels, ranks as you use the agent
- **Persona system** - markdown files shape the AI's personality
- **Desktop app** via Electron (not a browser tab)

## Quick Start

### Prerequisites

- **Python 3.10+** - [Download](https://python.org)
- **Node.js 18+** - [Download](https://nodejs.org)
- **API Key** - OpenRouter or Gemini

### Setup

```bash
# Clone the repo
git clone https://github.com/Mahesh776/Self-Improving-agent.git
cd Self-Improving-agent

# Windows - run installer
install.bat

# Or manually:
python -m venv .venv
.venv\Scripts\pip install -r backend\requirements.txt
.venv\Scripts\pip install -r tool_runtime\requirements.txt
npm install
```

### Configure

Copy `.env.example` to `.env` and add your API keys:

```env
OPENROUTER_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here
SCOUT_MODEL=openai/gpt-4o-mini
FORGE_MODEL=openai/gpt-4o-mini
```

Get keys at:
- OpenRouter: https://openrouter.ai/keys
- Gemini: https://aistudio.google.com/apikey

### Run

```bash
# Windows
start.bat

# Or manually
npm run electron:dev
```

The desktop app will open automatically.

## Architecture

```
ManusAgent/
├── electron/          # Electron desktop window
├── src/               # React + TypeScript frontend
│   ├── components/    # UI components
│   ├── hooks/         # React hooks
│   ├── state/         # Zustand store
│   └── api/           # API client
├── backend/           # Python FastAPI server
│   ├── app.py         # Main API (chat, forge, persona)
│   ├── llm_client.py  # OpenRouter + Gemini streaming
│   ├── tools_engine.py    # Skill loading/execution
│   ├── tool_creator.py    # LLM code generation
│   ├── build_pipeline.py  # Forge build phases
│   ├── persona.py     # Persona file management
│   └── gamification.py # XP, levels, ranks
├── tool_runtime/      # Isolated skill execution service
└── persona_defaults/  # Default persona markdown files
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `Ctrl+,` | Open settings |
| `Ctrl+Shift+N` | New chat |

## Built With

- **Electron** - Desktop window
- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Zustand** - State management
- **FastAPI** - Python backend
- **OpenRouter** - Multi-provider LLM routing
- **Google Gemini** - Direct API

## License

MIT
