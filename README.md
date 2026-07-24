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

## Features

| Feature | What it does |
| --- | --- |
| Live tail | New lines stream in real time and auto-scroll |
| Multi-service tabs | Each piped command is a colour-coded, filterable stream |
| Search | Instant substring filter with match highlighting |
| Level filters | Toggle `trace`/`debug`/`info`/`warn`/`error`/`fatal` chips |
| JSON expand | Click any structured (pino) line to pretty-print its fields |
| Pause / Resume | Freeze the view to read; a pill shows how many new lines arrived |
| Wrap | Toggle line wrapping for long messages |
| Clear | Empty the view (stream keeps running) |
| Download | Save the current buffer as a `.log` file |
| Error/warn tinting | Error rows are red, warnings amber |

## How it works

- `logapp` runs a tiny local daemon (Node `http`) on port `9999`.
- Piped stdout is streamed to the daemon over a single HTTP request.
- The daemon parses each line (pino JSON or plain text), keeps a ring buffer of
  the last few thousand lines, and pushes them to the browser over
  **Server-Sent Events**.
- The UI (`public/index.html`) is a single dependency-free page.

Change the port with `LOGAPP_PORT=4000 logapp`. Stop the daemon with
`logapp --stop`.

## License

MIT
