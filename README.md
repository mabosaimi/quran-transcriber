# Quran Transcriber

A Chrome extension that lets users follow along with Quran recitations playing in the browser by capturing tab audio, running real-time Arabic speech recognition, and displaying synchronized transcript text.

## Status

🚧 **Early development** — Core scaffold with audio capture and speech recognition pipeline.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full data flow.

**Key components:**

| Component | Role |
|-----------|------|
| **Service Worker** | Tab capture orchestration, state machine, message routing |
| **Side Panel** | Persistent UI — start/stop controls, transcript display |
| **Offscreen Document** | Audio playback + SpeechRecognition bridge |

## Development

**Prerequisites:** Node.js 18+, pnpm

```bash
# Install dependencies
pnpm install

# Start dev mode (auto-opens Chrome with extension loaded)
pnpm dev

# Production build
pnpm build

# Lint and format check
pnpm check

# Auto-fix lint and format issues
pnpm check:fix
```

## Project Structure

```
entrypoints/
├── background/       # Service worker
├── sidepanel/        # Side panel UI (HTML + TS + CSS)
└── offscreen/        # Audio capture + SpeechRecognition
lib/                  # Shared types and constants
public/
├── _locales/         # i18n (en, ar)
└── data/             # Quran text corpus (future)
```

## Tech Stack

- **WXT** — Extension framework (Vite-based, auto-manifest)
- **TypeScript** — Type safety across all contexts
- **Biome** — Linting and formatting
- **Chrome APIs** — `tabCapture`, `offscreen`, `sidePanel`, `storage`

## License

TBD
