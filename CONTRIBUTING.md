# Contributing to logapp

Thanks for taking the time to contribute! logapp is a small, dependency-free project, so it's easy to get started.

## Ground rules

- **Zero runtime dependencies.** The daemon and CLI use only Node's standard library, and the UI is a single dependency-free HTML file. Please keep it that way — no `npm install` should ever be required to run logapp.
- Keep it small and readable. Match the surrounding style.
- Every change should keep `npm test` green.

## Getting started

```bash
git clone https://github.com/ayush121314/logapp
cd logapp
./install.sh          # wires the `logapp` + `--logapp` zsh aliases
node bin/logapp.js    # or: npm start
```

Then run a server with `… --logapp` (or `| logapp`) and open `http://localhost:9999`.

## Project layout

| Path | What it is |
| --- | --- |
| `bin/logapp.js` | CLI + daemon — HTTP server, SSE, ingest, per-repo storage, `/query` |
| `public/index.html` | The entire single-page UI (style + markup + script) |
| `test/e2e.js` | Dependency-free backend E2E (`npm test`) |
| `docs/how-it-works.html` | Full internals walkthrough + sequence diagram |

## Tests

```bash
npm test
```

This runs the backend E2E suite (daemon health, port fallback, per-repo segment persistence, `/query` recent / search / cursor, etc.). Please add or update a case when you change ingest, storage, or the query engine. If your change touches the UI, describe how you verified it in the browser.

## Pull requests

1. Fork and create a branch from `main`.
2. Make your change; keep commits focused.
3. Ensure `npm test` passes.
4. Open a PR describing **what** changed and **why**, plus how you verified it.

## Reporting bugs / ideas

Open an issue using the templates. For bugs, include your OS, Node version, the command you ran, and what you expected vs. saw.
