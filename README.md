# Rafiq — your private coding agent

Rafiq is a local-first AI coding agent for Windows. Open a folder, describe a
goal, and Rafiq plans, then builds — with your own API key, on your own machine.

- **Desktop app** — a real Windows installer / portable `.exe` (Electron), no browser tab required
- **BYOK** — OpenAI, DeepSeek, Groq, OpenRouter, NVIDIA NIM, Ollama, LM Studio or any OpenAI-compatible endpoint
- **Plan → Build → Discuss** — read-only planning, then approved execution
- **Sandboxed** — file access is confined to the folder you open, commands need your approval, every turn can be undone
- **Bilingual** — full Arabic (RTL) and English UI, light and dark themes
- **Zero dependencies at runtime** — the agent, server and UI are plain Node + vanilla JS

## Get the app

Download the latest Windows build from the
[releases page](https://github.com/abdokem660-dev/rafiq/releases):

- `Rafiq-Setup-x.y.z.exe` — installer (per-user, no admin)
- `Rafiq-x.y.z-win-x64-portable.zip` — portable, unzip and run

The build isn't code-signed yet: SmartScreen may warn about an unknown publisher
→ **More info → Run anyway**. Check `SHA256SUMS.txt` to verify your download.

## Repository layout

| Path | What it is |
| --- | --- |
| `desktop/` | The Rafiq desktop app (Electron main + zero-dependency UI + tests) |
| `index.html`, `styles.css`, `app.js` | The bilingual landing page for the project |
| `.github/workflows/` | Builds the Windows installer and publishes releases |

Start with [`desktop/README.md`](desktop/README.md) for the app documentation,
safety model and development commands.

## Quick start (from source)

```bash
cd desktop
npm install
npm start        # desktop app
npm test         # unit + end-to-end tests, no network needed
npm run dist:win # build the Windows installer + portable zip
```

## How it stays private

Rafiq binds nothing to the public internet, ships no analytics, and makes exactly
one kind of outbound request: the call to the model provider you configured with
your own key. That key is encrypted with Windows DPAPI on disk, sessions are
stored in `%APPDATA%\Rafiq`, and the agent cannot touch files outside the
workspace folder.

## License

MIT
