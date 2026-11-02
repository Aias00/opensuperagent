import { t as tr, useLocale } from "../i18n";
import { useState, type FormEvent } from "react";
import {
  PlusIcon,
  CpuIcon,
  CheckCircleIcon,
  ArrowClockwiseIcon,
  LightningIcon,
  FloppyDiskIcon,
  TrashIcon,
  KeyIcon,
} from "@phosphor-icons/react";
import {
  api,
  type RuntimeSettings,
  type ProviderConfig,
  type ModelRouting,
  type ModelSelection,
} from "../api";
import { Button } from "./ui/button";
type Props = {
  settings: RuntimeSettings;
  profiles: string[];
  onSaved: (settings: RuntimeSettings) => void;
};
export function ModelSettings({ settings, profiles, onSaved }: Props) {
  useLocale();
  const [selected, setSelected] = useState(settings.providers[0]?.id ?? "new");
  return (
    <div className="model-settings">
      <div className="settings-explainer">
        <KeyIcon size={18} />
        <span>
          {tr("model.explainer")}{" "}
        </span>
      </div>
      <section className="panel provider-section">
        <div className="section-title">
          <div>
            <h2>LLM Providers</h2>
            <span>
              {settings.providers.length}
              {" "}{tr("model.countProviders")}
            </span>
          </div>
          <Button variant="outline" onClick={() => setSelected("new")}>
            <PlusIcon />
            {tr("model.addProvider")}{" "}
          </Button>
        </div>
        <div className="provider-layout">
          <div className="provider-list">
            {settings.providers.map((p) => (
              <button
                className={selected === p.id ? "active" : ""}
                key={p.id}
                onClick={() => setSelected(p.id)}
              >
                <CpuIcon size={19} />
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.protocol === "anthropic"
                      ? "Anthropic Messages"
                      : "OpenAI Compatible"}
                  </small>
                </span>
                {p.apiKeyConfigured && <KeyIcon size={13} />}
              </button>
            ))}
            {!settings.providers.length && (
              <p className="muted">
                {tr("model.emptyProviders")}{" "}
              </p>
            )}
          </div>
          <ProviderEditor
            key={selected}
            provider={settings.providers.find((p) => p.id === selected)}
            onSaved={(s, id) => {
              onSaved(s);
              setSelected(id);
            }}
          />
        </div>
      </section>
      <RoutingEditor
        settings={settings}
        profiles={profiles}
        onSaved={onSaved}
      />
    </div>
  );
}
const presets = [
  {
    name: "自定义 / OpenAI Compatible",
    url: "",
    protocol: "openai-compatible",
  },
  {
    name: "DeepSeek",
    url: "https://api.deepseek.com",
    protocol: "openai-compatible",
  },
  {
    name: "OpenAI",
    url: "https://api.openai.com/v1",
    protocol: "openai-compatible",
  },
  {
    name: "Anthropic",
    url: "https://api.anthropic.com/v1",
    protocol: "anthropic",
  },
  {
    name: "Ollama",
    url: "http://127.0.0.1:11434/v1",
    protocol: "openai-compatible",
  },
] as const;
function ProviderEditor({
  provider,
  onSaved,
}: {
  provider?: ProviderConfig;
  onSaved: (s: RuntimeSettings, id: string) => void;
}) {
  useLocale();
  const [draft, setDraft] = useState(() => ({
    id: provider?.id ?? `provider-${Date.now().toString(36)}`,
    name: provider?.name ?? "",
    protocol: provider?.protocol ?? "openai-compatible",
    baseUrl: provider?.baseUrl ?? "",
    apiKey: "",
    models: provider?.models.join("\n") ?? "",
    maxTokens: provider?.maxTokens ?? 8192,
  }));
  const [savedId, setSavedId] = useState(provider?.id ?? "");
  const [testModel, setTestModel] = useState(provider?.models[0] ?? "");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const patch = (key: string, value: string | number) =>
    setDraft((d) => ({ ...d, [key]: value }));
  async function action(kind: string, e?: FormEvent) {
    e?.preventDefault();
    setBusy(kind);
    setNotice(null);
    try {
      if (kind === "save") {
        const s = await api.saveProvider({
          ...draft,
          protocol: draft.protocol as ProviderConfig["protocol"],
          models: draft.models
            .split(/[\n,]/)
            .map((x) => x.trim())
            .filter(Boolean),
        });
        setDraft((d) => ({ ...d, apiKey: "" }));
        setSavedId(draft.id);
        onSaved(s, draft.id);
        setNotice({ text: tr("model.saved") });
      }
      if (kind === "models") {
        const r = await api.providerModels(savedId);
        setDraft((d) => ({ ...d, models: r.models.join("\n") }));
        if (!testModel) setTestModel(r.models[0] ?? "");
        setNotice({
          text: tr("model.modelsFound", {
            v0: r.models.length,
          }),
        });
      }
      if (kind === "test") {
        const r = await api.testProvider(savedId, testModel);
        setNotice({
          text: tr("model.testOk", {
            v0: r.model,
            v1: r.latencyMs,
          }),
        });
      }
      if (kind === "delete") {
        const s = await api.deleteProvider(savedId);
        onSaved(s, s.providers[0]?.id ?? "new");
      }
    } catch (e) {
      setNotice({
        text: e instanceof Error ? e.message : String(e),
        error: true,
      });
    } finally {
      setBusy("");
    }
  }
  return (
    <form
      className="provider-editor settings-form"
      onSubmit={(e) => void action("save", e)}
    >
      <div className="form-heading">
        <h3>{provider ? tr("model.editProvider") : tr("model.newProvider")}</h3>
        {provider && (
          <span className="key-status">
            <KeyIcon size={12} />
            {provider.apiKeyConfigured ? tr("model.keyConfigured") : tr("model.noKey")}
          </span>
        )}
      </div>
      {!provider && (
        <label>
          {tr("model.quickSetup")}{" "}
          <select
            aria-label={tr("model.preset")}
            defaultValue="0"
            onChange={(e) => {
              const p = presets[Number(e.target.value)]!;
              setDraft((d) => ({
                ...d,
                name: p.name,
                baseUrl: p.url,
                protocol: p.protocol,
              }));
            }}
          >
            {presets.map((p, i) => (
              <option key={p.name} value={i}>
                {tr(p.name)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="form-columns">
        <label>
          {tr("model.name")}{" "}
          <input
            aria-label={tr("model.providerName")}
            value={draft.name}
            onChange={(e) => patch("name", e.target.value)}
            required
            placeholder={tr("model.namePlaceholder")}
          />
        </label>
        <label>
          Provider ID
          <input
            aria-label="Provider ID"
            value={draft.id}
            onChange={(e) => patch("id", e.target.value)}
            required
            readOnly={!!provider}
            pattern="[a-zA-Z0-9_-]+"
          />
        </label>
      </div>
      <div className="form-columns">
        <label>
          {tr("model.protocol")}{" "}
          <select
            aria-label={tr("model.protocolAria")}
            value={draft.protocol}
            onChange={(e) => patch("protocol", e.target.value)}
          >
            <option value="openai-compatible">OpenAI Compatible</option>
            <option value="anthropic">Anthropic Messages</option>
          </select>
        </label>
        <label>
          {tr("model.maxTokens")}{" "}
          <input
            aria-label={tr("model.maxTokens")}
            type="number"
            min="64"
            max="262144"
            value={draft.maxTokens}
            onChange={(e) => patch("maxTokens", Number(e.target.value))}
            required
          />
        </label>
      </div>
      <label>
        Base URL
        <input
          type="url"
          aria-label="Provider Base URL"
          value={draft.baseUrl}
          onChange={(e) => patch("baseUrl", e.target.value)}
          required
          placeholder="https://api.example.com/v1"
        />
        <small>
          {tr("model.baseUrlHelp")}
        </small>
      </label>
      <label>
        API Key
        <input
          type="password"
          aria-label="Provider API Key"
          value={draft.apiKey}
          onChange={(e) => patch("apiKey", e.target.value)}
          autoComplete="new-password"
          placeholder={
            provider?.apiKeyConfigured
              ? tr("model.apiKeyKeep")
              : tr("model.apiKeyPlaceholder")
          }
        />
      </label>
      <label>
        {tr("model.modelId")}{" "}
        <textarea
          aria-label={tr("model.modelList")}
          value={draft.models}
          onChange={(e) => patch("models", e.target.value)}
          placeholder={tr("model.modelListPlaceholder")}
          rows={3}
        />
      </label>
      <div className="form-action-row">
        <Button type="submit" disabled={!!busy}>
          <FloppyDiskIcon />
          {busy === "save" ? tr("common.saving") : tr("model.save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!!busy || !savedId}
          onClick={() => void action("models")}
        >
          <ArrowClockwiseIcon className={busy === "models" ? "spin" : ""} />
          {tr("model.loadModels")}{" "}
        </Button>
        {provider && (
          <Button
            type="button"
            variant="ghost"
            className="danger-button"
            disabled={!!busy}
            onClick={() => void action("delete")}
            aria-label={tr("model.delete")}
          >
            <TrashIcon />
          </Button>
        )}
      </div>
      <div className="provider-test">
        <input
          aria-label={tr("model.testModelId")}
          placeholder={tr("model.testPlaceholder")}
          value={testModel}
          onChange={(e) => setTestModel(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!!busy || !savedId || !testModel.trim()}
          onClick={() => void action("test")}
        >
          <LightningIcon />
          {busy === "test" ? tr("model.testing") : tr("model.test")}
        </Button>
      </div>
      <small className="muted">
        {tr("model.testNote")}{" "}
      </small>
      {notice && (
        <div
          className={notice.error ? "error-banner" : "save-notice"}
          role={notice.error ? "alert" : "status"}
        >
          {!notice.error && <CheckCircleIcon size={15} />} {notice.text}
        </div>
      )}
    </form>
  );
}
function ModelPicker({
  label,
  value,
  providers,
  onChange,
  optional = false,
}: {
  label: string;
  value: ModelSelection | null;
  providers: ProviderConfig[];
  onChange: (v: ModelSelection | null) => void;
  optional?: boolean;
}) {
  useLocale();
  const p = providers.find((p) => p.id === value?.providerId);
  return (
    <div className="model-picker">
      <label>
        {tr(label)}
        <select
          aria-label={`${tr(label)} Provider`}
          value={value?.providerId ?? ""}
          onChange={(e) => {
            const p = providers.find((p) => p.id === e.target.value);
            onChange(p ? { providerId: p.id, model: p.models[0] ?? "" } : null);
          }}
        >
          <option value="">
            {optional ? tr("model.inheritWorker") : tr("model.selectProvider")}
          </option>
          {providers.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {tr("model.modelId")}{" "}
        <input
          aria-label={tr("model.modelOf", { v0: label })}
          list={`models-${tr(label)}`}
          value={value?.model ?? ""}
          disabled={!value}
          onChange={(e) =>
            value && onChange({ ...value, model: e.target.value })
          }
          placeholder={tr("model.modelPlaceholder")}
        />
        <datalist id={`models-${tr(label)}`}>
          {p?.models.map((m) => (
            <option value={m} key={m} />
          ))}
        </datalist>
      </label>
    </div>
  );
}
function RoutingEditor({ settings, profiles, onSaved }: Props) {
  useLocale();
  const [routing, setRouting] = useState<ModelRouting>(settings.routing);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  return (
    <section className="panel settings-panel model-routing">
      <h2>
        <CpuIcon />
        {tr("model.routing")}{" "}
      </h2>
      <p className="muted">
        {tr("model.routingNote")}{" "}
      </p>
      <form
        className="settings-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const s = await api.saveRouting(routing);
            onSaved(s);
            setNotice(tr("model.routingSaved"));
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <ModelPicker
          label="Router"
          providers={settings.providers}
          value={routing.router}
          onChange={(v) => setRouting((r) => ({ ...r, router: v }))}
        />
        <ModelPicker
          label={tr("model.defaultWorker")}
          providers={settings.providers}
          value={routing.worker}
          onChange={(v) => setRouting((r) => ({ ...r, worker: v }))}
        />
        {profiles.map((profile) => (
          <ModelPicker
            key={profile}
            label={profile}
            optional
            providers={settings.providers}
            value={routing.profiles[profile] ?? null}
            onChange={(v) =>
              setRouting((r) => {
                const profiles = { ...r.profiles };
                if (v) profiles[profile] = v;
                else delete profiles[profile];
                return { ...r, profiles };
              })
            }
          />
        ))}
        <div className="form-action-row">
          <Button
            disabled={busy || !routing.router?.model || !routing.worker?.model}
            type="submit"
          >
            <FloppyDiskIcon />
            {tr("model.routingSave")}{" "}
          </Button>
        </div>
        {error && (
          <div role="alert" className="error-banner">
            {error}
          </div>
        )}
        {notice && (
          <div className="save-notice" role="status">
            {notice}
          </div>
        )}
      </form>
    </section>
  );
}
