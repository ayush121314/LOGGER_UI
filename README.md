# logapp

A live log viewer with a **Grafana-style browser UI** for any local server.

Pipe any process into `logapp` and watch its logs stream live in Chrome at
`http://localhost:9999` — search, level filters, per-service tabs, JSON expand,
pause, and download. Zero dependencies (pure Node), zero changes to your app.

![logapp UI](docs/screenshot.png)

## Why

Local dev servers print logs to the terminal, where they scroll away and can't be
searched or filtered. `logapp` captures that stdout and gives you a proper log
dashboard in the browser — while still printing to your terminal unchanged.

## Install

```bash
git clone https://github.com/ayush121314/LOGGER_UI logapp
cd logapp
./install.sh          # adds `logapp` + `--logapp` to your ~/.zshrc
source ~/.zshrc       # or open a new terminal
```

No `npm install` needed — logapp uses only Node's standard library.

## Usage

Three ways, pick whatever fits:

```bash
# 1. Append --logapp to the END of any start command
source env.sh && npm start --logapp

# 2. Explicit pipe (identical to above)
npm start | logapp

# 3. Just open the empty dashboard
logapp
```

Then open **http://localhost:9999** in Chrome. Every command you pipe becomes its
own colour-coded tab, so you can watch several servers side by side:

```bash
cd ecommerce-backend && npm start --logapp     # tab 1
cd ecom-cron-worker  && npm start --logapp     # tab 2
```

Your terminal still shows the original logs — `logapp` only tees a copy to the UI.

### How `--logapp` works

`install.sh` adds a zsh **global alias** to your `~/.zshrc`:

```zsh
alias logapp='node /path/to/logapp/bin/logapp.js'
alias -g -- --logapp='| logapp'
```

Because it's a *global* alias, zsh rewrites `--logapp` anywhere on the line into
`| logapp`, so appending `--logapp` to any command pipes it into the viewer.

The UI is a **Grafana Explore–style** logs view.

## Features

| Feature | What it does |
| --- | --- |
| Live tail | New lines stream in real time; `Live` toggle + a "N new" pill when scrolled away |
| Logs volume histogram | Stacked bars per time bucket, coloured by level; legend toggles levels |
| Level labels | Each line shows its level (`INFO`/`WARN`/`ERROR`…) in colour; error lines are red |
| Port search | Type a port — logapp auto-detects each server's listening port and filters to it |
| Line filters | Loki-style `Line contains` (`\|=`) / `does not contain` (`!=`) / regex (`\|~` `!~`) |
| Select-to-filter | Select any text in a line **or** in the expanded JSON → popup to add a contains / does-not-contain filter |
| Search | Highlights matches (in the line **and** the pretty JSON) without hiding non-matches |
| Time range | Grafana-style picker (Last 5m/15m/30m/1h/3h) filters by timestamp |
| Pretty JSON | On by default — every line auto-expands to a syntax-highlighted, indented JSON view |
| Wrap / Time / Dedup | Wrap long lines, hide timestamps, collapse consecutive duplicates (`×N`) |
| Sort / Download | `Newest first` / `Oldest first`; save the buffer as a `.log` |

## Storage

Each live server's logs are also written to disk at
`~/Downloads/logapp-logs/<stream>.jsonl` (override with `LOGAPP_LOGS_DIR`). The
file exists only while the server runs — **when the server/port is killed, its
file is auto-deleted**. Files are wiped on daemon start and capped
(`LOGAPP_MAX_FILE_MB`, default 2048) so they never fill the disk. In-memory the
daemon keeps a bounded ring (`LOGAPP_BUFFER`, default 20000) and only ships the
last `LOGAPP_SNAPSHOT` (4000) lines to a new browser tab so Chrome stays light.

## How it works

- `logapp` runs a tiny local daemon (Node `http`), preferring port `9999`. If
  `9999` is taken by another app it falls back to `9998`, `9997`, … or any free
  port; the client discovers the daemon's actual port via `~/.logapp/daemon.port`
  and opens the browser there. A lock file guarantees a single daemon.
- The daemon is auto-started on the first `--logapp` and opens the browser for you.
- Piped stdout streams to the daemon over one long-lived HTTP request
  (request timeouts disabled, with client auto-reconnect, so long-running servers
  keep streaming for hours).
- The daemon parses each line (pino JSON or plain text), auto-detects the source
  server's listening port (`lsof` over the pipeline's full process tree — works
  even under nodemon/pm2), and pushes over **Server-Sent Events**.
- The UI (`public/index.html`) is a single dependency-free page.

Stop the daemon with `logapp --stop`. Run the backend tests with `npm test`.

## License

MIT
