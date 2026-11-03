# OpenSuperAgent Web Console

React / TypeScript / Vite 工作台，参考 [Shadcn Admin](https://github.com/satnaing/shadcn-admin) 的导航与工作区布局。组件采用 shadcn/ui / Radix、Tailwind CSS v4、Phosphor，执行拓扑使用 React Flow。

需要 Node.js 22.13+。在仓库根目录运行：

```sh
npm run dev -- serve
npm run dev:web
```

开发界面位于 http://localhost:5173，API 代理到 http://127.0.0.1:7420。`npm run build` 同时构建运行时和 Web，随后主服务直接提供静态控制台。

## 页面

- 执行总览：入口、Router、Worker、Skills、迭代及投递拓扑。
- 任务运行：筛选任务，查看来源、轮次、技能调用、结果和投递。
- Router：独立的路由事件流和消息提交。
- Worker Agents / Skills：独立目录，以引用关系互相导航。
- 消息接入：真实外部来源状态及入站路由记录。
- 系统设置：LLM Providers、API Key、Router / Worker 模型路由、原生适配器配置、运行信息和连接 Token。

GitHub、飞书、Webhook 已实现原生收发；在系统设置中填写凭据和白名单后启用。飞书默认使用官方 SDK 长连接，无需公网入口；页面显示实际连接状态并支持重连。GitHub / Webhook 需要外部平台能访问对应的 `/hooks/:channel` HTTPS 回调地址。其他通道的启用状态只表示本地配置。

## 验证

```sh
npm run build
npm test
npm run test:integrations
# 显式调用已配置的真实模型，平台端点仍使用本地 HTTP 仿真：
npm run verify:live
npm --prefix web run lint
```

shadcn/ui 组件为 CLI 生成的本地源码；本项目自行实现领域布局，没有复制模板业务逻辑。
