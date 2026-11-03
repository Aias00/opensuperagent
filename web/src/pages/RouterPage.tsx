import { t as tr, useLocale } from "../i18n";
import { useState, type FormEvent } from "react";
import { api, type Overview } from "../api";
import { ArrowsSplitIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { Button } from "../components/ui/button";
import { PageHeading, SectionTitle, EventFeed } from "../components/shared";
export function RouterPage({
  data,
  onTask,
  refresh,
  notify,
}: {
  data: Overview;
  onTask: (id: string) => void;
  refresh: () => Promise<void>;
  notify: (text: string, error?: boolean) => void;
}) {
  useLocale();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.routerMessage(text.trim());
      setText("");
      notify(tr("router.sent"));
      await refresh();
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="ROUTER"
        title={tr("router.title")}
        description={tr(
          "router.description",
        )}
      />
      <div className="router-layout">
        <section className="panel">
          <SectionTitle
            title={tr("router.activity")}
            meta={tr("router.roundsMeta", { v0: data.router.runs.length })}
          />
          <EventFeed
            events={
              data.router.journal ??
              data.events.filter((e) => e.scope === "router")
            }
            onTask={onTask}
          />
          <form className="router-composer" onSubmit={(e) => void send(e)}>
            <textarea
              aria-label={tr("router.sendToRouter")}
              placeholder={tr("router.composerPlaceholder")}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <Button disabled={busy || !text.trim()} type="submit">
              <PaperPlaneTiltIcon />
              {tr("router.sendToRouter")}{" "}
            </Button>
          </form>
        </section>
        <aside className="router-info">
          <div className="panel">
            <span className="object-icon orange">
              <ArrowsSplitIcon size={28} />
            </span>
            <h2>Router</h2>
            <p>
              <span
                className={`state-dot ${data.router.active ? "running" : ""}`}
              />
              {data.router.active ? tr("router.deciding") : tr("common.waitingRequest")}
            </p>
            <dl>
              <dt>{tr("common.model")}</dt>
              <dd>{data.router.model}</dd>
              <dt>{tr("router.availableWorkers")}</dt>
              <dd>{data.definitions.length}</dd>
              <dt>{tr("router.queuedInputs")}</dt>
              <dd>{data.router.queued}</dd>
            </dl>
          </div>
          <div className="panel">
            <h3>{tr("router.actions")}</h3>
            <div className="tag-list">
              {[
                "list_tasks",
                "read_task",
                "read_trigger",
                "start_task",
                "send_to_task",
                "stop_task",
                "reply",
              ].map((tool) => (
                <span className="tag" key={tool}>
                  {tool}
                </span>
              ))}
            </div>
            <p className="muted">
              {tr("router.roleDescription")}{" "}
            </p>
          </div>
          {data.router.instructions && (
            <div className="panel">
              <h3>{tr("router.routingRules")}</h3>
              <p className="preserve-lines">{data.router.instructions}</p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
