import type { SettingsStore } from "../../settings/store.js";
import type { Store } from "../../storage/index.js";
import { GithubAdapter } from "./github.js";
import { FeishuAdapter } from "./feishu.js";
import { WebhookAdapter } from "./webhook.js";
export class Adapters {
  readonly github: GithubAdapter;
  readonly feishu: FeishuAdapter;
  readonly webhook: WebhookAdapter;
  constructor(settings: SettingsStore, store: Store) {
    this.github = new GithubAdapter(settings, store);
    this.feishu = new FeishuAdapter(settings, store);
    this.webhook = new WebhookAdapter(settings);
  }
}
