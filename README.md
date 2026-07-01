# REKH — a quiet, privacy-focused browser

REKH is a desktop web browser built on Electron, with a built-in AI assistant and
a privacy stack (ad/tracker blocking, proxy kill-switch, HTTPS-only, DoH).

> *knowledge · awareness · understanding*

## Features

**Browsing**
- Tabs with real site favicons, back / forward / reload, find-in-page (`Cmd+F`)
- Google-style start page (REKH wordmark + centered search)
- Links open in new tabs, session restore on relaunch
- Persistent Bookmarks · History · Downloads (📚 Library)

**Look & feel**
- Light / dark theme that auto-switches by time of day (◐ button: Auto / Light / Dark)
- Frameless window; on macOS the toolbar clears the native traffic-light buttons

**Privacy** (Settings → Privacy)
- Ad/tracker blocker — Ghostery engine (EasyList/EasyPrivacy + annoyances + cookie + social)
  with cosmetic element-hiding; live blocked counter next to the shield
- Hide sponsored search results (Google, Bing, DuckDuckGo, Yahoo, Ecosia)
- HTTPS-only mode, DNS-over-HTTPS, clear-data-on-exit
- VPN/proxy with a **fail-closed** kill switch and IP-leak detection

**AI assistant** (✦ panel)
- Chat with the current page + follow-up questions
- Quick actions: Summarize · Explain · Extract · Rewrite
- Providers: **Anthropic (Claude)**, OpenAI, OpenRouter, Ollama
- API key stored in the OS keychain (`safeStorage`) and used **only in the main
  process** — it never enters page-facing code

## Requirements

- **Node.js 18+** and npm. (This project was developed with Node v20.)

## Run it

```bash
cd rekh-desktop
npm install      # pulls Electron (~150 MB, prebuilt — no compiling)
npm start        # launches the app
```

## Package installers

```bash
npm run dist         # current platform
npm run dist:mac     # .dmg + .zip
npm run dist:win     # nsis + portable
npm run dist:linux   # AppImage + deb
```

Output lands in `dist/`. Note: to ship without OS "unidentified developer"
warnings you'll also need code-signing (Apple Developer cert on macOS,
a code-signing cert on Windows) — separate from this build step.

## Configure the AI

Open the **✦** panel → Settings **⚙** → **AI Config**:
1. Pick a provider (endpoint + model auto-fill).
2. Paste your API key (Anthropic uses `x-api-key`; OpenAI/OpenRouter use a Bearer key; Ollama needs no key).
3. Save, then ask questions in the AI panel.

## Project layout

```
rekh-desktop/
  main.js            Electron main process (windows, proxy, ad-block, AI relay, downloads)
  preload.js         contextBridge API exposed to the renderer
  renderer/
    newtab.html      app shell
    newtab.css       themed styles (CSS variables)
    newtab.js        tabs, omnibox, library, AI chat, settings, theme
  package.json       scripts + electron-builder config
```

## Notes

- `publish.owner` in `package.json` is a placeholder (`YOUR_GITHUB`) — set your
  GitHub org/repo before enabling auto-update.
- A separate `rekh-mobile/` (Capacitor) exists but general browsing there needs a
  native WebView; it can't render most sites in an `<iframe>`.
