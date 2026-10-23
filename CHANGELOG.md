# Changelog

## v0.2.1

- Fixed ordered lists in rendered answers and plans (numbers were shown instead of the item text).
- Added a renderer smoke test that boots the real UI in jsdom and drives workspace,
  sessions, file viewer, modes, settings, streaming, tool cards, plan cards,
  approvals, i18n and theming.
- The build workflow now publishes SHA-256 checksums inside the release notes.
- Added the MIT license file.

## v0.2.0 — first Windows desktop release

- Rafiq desktop app for Windows (Electron): plan → build → discuss agent loop with
  9 file/shell tools, streamed output and session history.
- Sandboxed workspace: path containment, ignore rules, binary skipping.
- Bring your own key for OpenAI, DeepSeek, Groq, OpenRouter, NVIDIA NIM,
  Ollama/LM Studio or any OpenAI-compatible endpoint; key encrypted with DPAPI.
- Safety: command denylist, per-command approval, per-turn undo snapshots.
- Bilingual EN/AR UI with RTL, light/dark themes, built-in file explorer.
- NSIS installer + portable zip, built and published by GitHub Actions.
- Optional localhost HTTP mode (`npm run server`) with the same UI and agent.

## v0.1.0

- Bilingual landing page with download section.
