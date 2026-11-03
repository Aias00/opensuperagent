# OpenSuperAgent

**An open-source implementation of DeepSeek's Super-agent design.**

[English](README.en.md) | [简体中文](README.md)

Inspired by the DeepSeek Harness team's [Super-agent Design Exploration: Toward More Autonomous Agent Systems](https://mp.weixin.qq.com/s/zoS7GlReWPhfCjENGxXCdg), I build OpenSuperAgent: a self-hosted, open-source implementation of the Super-agent concept.

The goal: an agent that picks up messages from your workflow, keeps track of each task, and moves multiple jobs forward. Give it a goal, add direction along the way, and check in to review progress and results.

The project is still in its early stages. Join in to explore and improve it.

## Try it

Requires **Node.js >= 22.13.0** and access to a model API.

```sh
npm install -g opensuperagent
opensuperagent init
opensuperagent serve
```

Open [http://127.0.0.1:7420](http://127.0.0.1:7420). Under **System settings → Models and Provider**, add a provider, API key, and model, then configure Router and Worker routes. Submit your first task from the console.

## Make it yours

Start with 10 Workers and 13 Skills covering development, testing, review, documentation, data analysis, and more. Add your own roles and working methods:

| Extension | Start here |
| --- | --- |
| Worker: role, tools, and model | [`seed/definitions`](seed/definitions) |
| Skill: reusable instructions and resources | [`seed/skills`](seed/skills) |
| Instance configuration | [`config.example.yaml`](config.example.yaml) |

```sh
opensuperagent def import ./my-worker.json
opensuperagent skill import ./my-skill
```

Configuration and runtime data live in `~/.opensuperagent` by default. Select another configuration file with `--config <path>`.

## Develop locally

```sh
npm ci
npm ci --prefix web
npm run dev -- serve
# In another terminal
npm run dev:web
```

Checks and build: `npm run typecheck`, `npm --prefix web run lint`, `npm test`, `npm run build`.

Try it in your workflow, [open an issue](https://github.com/thefullgc/opensuperagent/issues), or contribute code to help turn these ideas into a useful everyday tool.

## License

[Apache License 2.0](LICENSE) · Copyright 2026 OpenSuperAgent contributors.
