# OpenSuperAgent

**DeepSeek Super-agent 开源落地实现。**

[English](README.en.md) | [简体中文](README.md)

受 DeepSeek Harness 团队[《Super-agent 设计探索：迈向更自主的 Agent 系统》](https://mp.weixin.qq.com/s/zoS7GlReWPhfCjENGxXCdg)的启发，肝了 OpenSuperAgent：一个可自部署的 Super-agent 开源落地实现。

希望它能接住日常工作里的消息，记住任务的来龙去脉，并行把事情往前推。你提出需求、补充方向，在需要时查看进展、验收结果。

项目还在早期，欢迎一起探索和改进。

![flow](./resource/flow.png)

## 试试看

需要 **Node.js >= 22.13.0**，以及可用的模型 API。

```sh
npm install -g opensuperagent
opensuperagent init
opensuperagent serve
```

打开 [http://127.0.0.1:7420](http://127.0.0.1:7420)，在 **系统设置 → 模型与 Provider** 中添加服务、API Key 和模型，并配置 Router 与 Worker 的模型路由，即可提交第一个任务。


## 按你的方式扩展

内置 10 个 Worker 和 13 个 Skill，覆盖开发、测试、审查、文档、数据分析等任务。你也可以定义自己的角色和工作方法：

| 扩展 | 从这里开始 |
| --- | --- |
| Worker：角色、工具权限与模型 | [`seed/definitions`](seed/definitions) |
| Skill：可复用的操作说明与资源 | [`seed/skills`](seed/skills) |
| 实例配置 | [`config.example.yaml`](config.example.yaml) |

```sh
opensuperagent def import ./my-worker.json
opensuperagent skill import ./my-skill
```

默认配置与运行数据保存在 `~/.opensuperagent`，可通过 `--config <路径>` 指定配置文件。

所有 CLI 命令（包括 `init`）按以下优先级选择配置：`--config <路径>` > `OPENSUPERAGENT_CONFIG` > 当前目录的 `config.yaml` > `~/.opensuperagent/config.yaml`。显式指定的配置文件不存在，或 `--config` 缺少路径时，命令会报错退出；只有未指定且未发现配置时，`init` 才创建默认配置。

## 本地开发

```sh
npm ci
npm ci --prefix web
npm run dev -- serve
# 另一个终端
npm run dev:web
```

检查与构建：`npm run typecheck`、`npm --prefix web run lint`、`npm test`、`npm run build`。

欢迎带着自己的工作场景来试用、提 [Issue](https://github.com/thefullgc/opensuperagent/issues) 或贡献代码，一起把这套思路打磨成好用的工具。

## 许可证

[Apache License 2.0](LICENSE) · Copyright 2026 OpenSuperAgent contributors.
