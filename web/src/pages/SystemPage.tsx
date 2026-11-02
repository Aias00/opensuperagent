import { t as tr, useLocale } from "../i18n";
import { useEffect, useState } from "react";
import {
  api,
  type Overview,
  type RuntimeSettings,
  type SystemInfo,
} from "../api";
import {
  CpuIcon,
  ShieldCheckIcon,
  ArrowUpRightIcon,
} from "@phosphor-icons/react";
import { Button } from "../components/ui/button";
import { ModelSettings } from "../components/ModelSettings";
import { AdapterSettings } from "../components/AdapterSettings";
import { PageHeading } from "../components/shared";
export function SystemPage({
  data,
  openToken,
}: {
  data: Overview;
  openToken: () => void;
}) {
  useLocale();
  const [tab, setTab] = useState("runtime");
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [settingsError, setSettingsError] = useState("");
  useEffect(() => {
    let cancelled = false;
    api
      .settings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch((e) => {
        if (!cancelled) setSettingsError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    api
      .system()
      .then((r) => {
        if (!cancelled) {
          setInfo(r);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [data.generatedAt]);
  return (
    <>
      <PageHeading
        eyebrow="SYSTEM"
        title={tr("system.title")}
        description={tr(
          "system.description",
        )}
      />
      <div className="settings-tabs tab-bar">
        <button
          className={tab === "runtime" ? "active" : ""}
          onClick={() => setTab("runtime")}
        >
          {tr("system.tabRuntime")}{" "}
        </button>
        <button
          className={tab === "models" ? "active" : ""}
          onClick={() => setTab("models")}
        >
          {tr("system.tabModels")}{" "}
        </button>
        <button
          className={tab === "adapters" ? "active" : ""}
          onClick={() => setTab("adapters")}
        >
          {tr("system.tabAdapters")}{" "}
        </button>
      </div>
      {settingsError && <div className="error-banner">{settingsError}</div>}
      {!settings && tab !== "runtime" && !settingsError && (
        <div className="loading-state">{tr("system.loadingSettings")}</div>
      )}
      {tab === "models" && settings && (
        <ModelSettings
          settings={settings}
          profiles={[...new Set(data.definitions.map((d) => d.modelProfile))]}
          onSaved={setSettings}
        />
      )}
      {tab === "adapters" && settings && (
        <AdapterSettings settings={settings} onSaved={setSettings} />
      )}
      {tab === "runtime" && (
        <div className="settings-grid">
          <section className="panel settings-panel">
            <h2>
              <CpuIcon />
              {tr("system.instance")}{" "}
            </h2>
            {error && <div className="error-banner">{error}</div>}
            <dl>
              <dt>{tr("system.runMode")}</dt>
              <dd>
                {data.agent === "llm"
                  ? tr("system.modeLlm")
                  : data.agent === "mvp"
                    ? tr("system.modeMvp")
                    : tr("system.modeUnconfigured")}
              </dd>
              <dt>{tr("system.listen")}</dt>
              <dd>{info?.listen ?? tr("system.loading")}</dd>
              <dt>{tr("system.dataDir")}</dt>
              <dd>
                <code>{info?.dataRoot ?? tr("system.loading")}</code>
              </dd>
              <dt>{tr("system.capacity")}</dt>
              <dd>
                {data.stats.active} / {data.stats.capacity}
              </dd>
              <dt>Worker / Skills</dt>
              <dd>
                {data.definitions.length} / {data.skills.length}
              </dd>
            </dl>
          </section>
          <section className="panel settings-panel">
            <h2>
              <ShieldCheckIcon />
              {tr("system.connection")}{" "}
            </h2>
            <p className="muted">
              {tr("system.tokenNote")}
            </p>
            <Button variant="outline" onClick={openToken}>
              {tr("system.tokenManage")}{" "}
              <ArrowUpRightIcon />
            </Button>
            <dl>
              <dt>{tr("system.unknownOps")}</dt>
              <dd>{info?.unknownOps ?? 0}</dd>
              <dt>{tr("system.pendingDeliveries")}</dt>
              <dd>{info?.pendingDeliveries ?? 0}</dd>
              <dt>{tr("system.externalChannels")}</dt>
              <dd>{tr("system.seeConnections")}</dd>
            </dl>
          </section>
        </div>
      )}
    </>
  );
}
