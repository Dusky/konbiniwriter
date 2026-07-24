# Getting Started

A quick setup guide for running Konbini on a fresh machine. For the
architecture and the rules that never bend, see `CLAUDE.md`; for the roadmap,
see `PLAN.md`.

## Prerequisites

- **Node.js 18+** and **npm**
- **Git**
- A **Chromium browser** (Chrome or Edge) for the full browser experience —
  Firefox/Safari work too but fall back to app-internal (OPFS) storage.

## 1. Clone & install

```bash
git clone https://github.com/Dusky/konbiniwriter.git
cd konbiniwriter
git checkout main            # all work lives on main

npm install                  # add --legacy-peer-deps if you hit peer conflicts
```

## 2. Run it

### Desktop app — one command

```bash
npm run app
```

This starts the Vite dev server, waits for it to come up, then compiles and
launches the Electron window against it. Closing either one tears both down —
no more juggling terminals. (Uses `concurrently` + `wait-on` under the hood.)

### Browser only

```bash
npm run dev
```

Opens the Vite dev server at **http://localhost:5173**. Best in Chrome/Edge,
where projects are real folders on disk (File System Access API).

### Electron the manual way (two terminals)

If you want the Vite and Electron logs in separate windows:

```bash
npm run dev            # terminal 1: Vite
npm run electron:dev   # terminal 2: compile electron/ + launch the window
```

## 3. Verify before committing

Both type-checks must pass with zero errors, and the test suite must be green:

```bash
npm run build              # typecheck + production web build (renderer)
npm run electron:compile   # typecheck the Electron main/preload
npm test                   # vitest suite
```

## 4. Package the desktop app

```bash
npm run electron:build     # web build + electron-builder → installers in dist/
```

## Notes

- **AI is bring-your-own-key and off by default.** The studio is fully usable
  with AI disabled. To enable it, open **AI Settings** and add an API key, or
  sign in with a Claude subscription (OAuth — desktop app only, since the
  subscription path is proxied through the Electron main process).
- **Projects are plain `.konbini` folders** of Markdown + a JSON manifest on
  Chrome/Edge and Electron. Firefox/Safari store projects in the browser's
  private OPFS instead.
- If Electron ever complains about a missing `electron-updater` module, just
  re-run `npm install` — it's lazy-loaded and only needed for packaged builds.
