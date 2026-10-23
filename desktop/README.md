# Rafiq Desktop

Rafiq is a private, local-first coding agent for Windows. It runs as a normal
desktop app, works only inside the folder you open, and talks directly to the
model provider you choose with your own API key (BYOK).

```
┌───────────────── RAFIQ ─────────────────┐
│ Plan → Build → Discuss, bilingual AR/EN │
│ reads + writes only inside one folder   │
│ every turn is undoable                  │
└─────────────────────────────────────────┘
```

## Download

Grab the latest build from the [releases page](https://github.com/abdokem660-dev/rafiq/releases):

| File | What it is |
| --- | --- |
| `Rafiq-Setup-x.y.z.exe` | Windows installer (per-user, no admin needed) |
| `Rafiq-x.y.z-win-x64-portable.zip` | Portable — unzip and run `Rafiq.exe` |
| `SHA256SUMS.txt` | Checksums for both files |

The build is not code-signed yet, so SmartScreen may show
*"Unknown publisher"* → **More info → Run anyway**.

## First run

1. **Open a folder.** Rafiq can only read and write inside it (path containment
   is enforced for every single file operation).
2. **Settings → provider.** Pick OpenAI, DeepSeek, Groq, OpenRouter, NVIDIA NIM,
   Ollama/LM Studio (local), or paste any OpenAI-compatible base URL, then add
   your key. The key is encrypted with Windows DPAPI before it is written to
   disk, and it is never logged or sent anywhere except your provider.
3. **Describe a goal.** In *Plan* mode Rafiq studies the code read-only and
   writes a plan. Approve it to switch to *Build*, or chat in *Discuss* mode.

## Safety model

| Risk | How Rafiq handles it |
| --- | --- |
| Reading/writing the wrong files | Every path is resolved and checked to stay inside the workspace; absolute paths and `..` are rejected |
| Running something destructive | A denylist blocks disk/registry/account/boot commands; every command asks for approval first |
| Breaking your project | The file contents touched in a turn are snapshotted in memory — **Undo changes** restores them |
| Leaking your key | Stored with `safeStorage` (DPAPI on Windows), never rendered back to the UI |
| Phoning home | No telemetry, no account, no auto-update pings. The only outbound request is your provider call |

## Modes and tools

| Mode | File tools | Shell | Notes |
| --- | --- | --- | --- |
| Plan | read-only | blocked | produces a plan card you can approve |
| Build | read + write | with approval | runs tests/builds and reports exit codes |
| Discuss | read-only | blocked | Q&A over your codebase |

Tools available to the model: `list_dir`, `read_file`, `search_files`,
`write_file`, `edit_file`, `make_dir`, `delete_path`, `move_path`,
`run_command`.

## Development

```bash
cd desktop
npm install
npm start          # run the Electron app
npm run server     # run the UI in a browser at http://127.0.0.1:4123
npm test              # unit + end-to-end + UI smoke tests (no network needed)
npm run test:unit     # workspace, safety, store, agent
npm run test:e2e      # mock provider drives the real agent loop
npm run test:ui       # jsdom boots the UI and clicks through it
npm run dist:win   # build the Windows installer and portable zip
```

Environment variables for `npm run server`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `RAFIQ_PORT` | `4123` | HTTP port |
| `RAFIQ_HOST` | `127.0.0.1` | bind address |
| `RAFIQ_DATA_DIR` | `%APPDATA%\Rafiq` | where settings/sessions live |
| `RAFIQ_WORKSPACE` | current directory | folder to open on start |
| `RAFIQ_ALLOW_FRAME` | `0` | allow embedding behind a proxy (dev previews only) |

### Layout

```
desktop/
  src/main/main.js       Electron bootstrap, IPC, menus, window state
  src/main/preload.js    narrow contextBridge API (no node in the renderer)
  src/main/agent.js      plan → build → discuss loop, tools, approvals, undo
  src/main/workspace.js  sandboxed filesystem (containment, ignore rules)
  src/main/providers.js  streaming OpenAI-compatible client + friendly errors
  src/main/commands.js   shell runner + command denylist
  src/main/store.js      settings/sessions (atomic JSON writes, DPAPI keys)
  src/main/server.js     optional localhost HTTP mode (same UI, same agent)
  src/renderer/          zero-dependency UI (markdown, i18n, RTL, themes)
  test/run.js            unit tests (sandbox, safety, store, agent, provider)
  test/e2e.js            mock-provider end-to-end test over the local server
  test/ui-smoke.js       jsdom smoke test of the real renderer
```

## Releases

Pushing a tag (`git tag v0.2.0 && git push origin v0.2.0`) or running the
**Build Windows app** workflow publishes the installer, portable zip and
checksums automatically.

## License

MIT
