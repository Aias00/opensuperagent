# OpenSuperAgent

Persistent collaborative agent — a Router that triages incoming work and
Workers that execute it, with a web console, SQLite-backed state, and
channel adapters (console, GitHub, Feishu, generic webhook).

Requires Node.js >= 22.

## Install

From the npm tarball:

```sh
npm install -g opensuperagent-0.1.0.tgz
```

Or from a checkout of this repository:

```sh
npm install          # also builds web/ on first `npm run build`
npm run build
npm link             # exposes the `opensuperagent` command
```

## Quick start

```sh
opensuperagent init     # creates ~/.opensuperagent + config, imports seeds
opensuperagent serve    # starts API + web console on 127.0.0.1:7420
```

Then open http://127.0.0.1:7420 and add an LLM provider under System →
Models (or set `DEEPSEEK_API_KEY` / drop `<data_root>/secrets/llm.json`).

## Where things live

All runtime state — `state.sqlite`, session event logs, operation
`output.log`s, workspaces, blobs, and secrets — lives under the data root:

| Location | Value |
|---|---|
| Default data root | `~/.opensuperagent` |
| Override | `OPENSUPERAGENT_DATA_ROOT=/path/to/dir` |
| Default config | `~/.opensuperagent/config.yaml` |

Relative `data_root` values resolve against the directory containing the
config file, so the data location never depends on the launch directory.

## Configuration

`config.yaml` is discovered in this order:

1. `--config <path>` CLI flag
2. `OPENSUPERAGENT_CONFIG` env var
3. `./config.yaml` in the current directory (project-local)
4. `~/.opensuperagent/config.yaml` (user-level, written by `init`)
5. Built-in defaults when no file exists

See `config.example.yaml` for all options. Environment variables:

- `OPENSUPERAGENT_DATA_ROOT` — data root override
- `OPENSUPERAGENT_ADMIN_TOKEN` — required for non-loopback API access
- `DEEPSEEK_API_KEY` / `OPENSUPERAGENT_LLM_*` — legacy LLM bootstrap

## Commands

```
opensuperagent init [--config path]   Create data dirs, migrate schema, import seed
opensuperagent serve [--config path]  Start main process (API + loops)
opensuperagent def import <file.json> Import a worker definition
opensuperagent def export <id>        Print definition JSON
opensuperagent skill import <dir>     Import a skill directory (SKILL.md)
opensuperagent skill list             List skills
```

## Development

```sh
npm run dev          # run from source (tsx)
npm test             # unit tests
npm run typecheck    # tsc --noEmit
npm run build        # tsc + web build → dist/, web/dist
npm pack             # build + produce opensuperagent-0.1.0.tgz
```
