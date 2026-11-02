import { t as tr, useLocale } from "../i18n";
import { useEffect, useState } from "react";
import { api, type Overview, type InboundMessage } from "../api";
import type { Selection } from "../components/Details";
import {
  ArrowUpRightIcon,
  ArrowRightIcon,
  ArrowsSplitIcon,
  RobotIcon,
} from "@phosphor-icons/react";
import { Button } from "../components/ui/button";
import {
  PageHeading,
  SectionTitle,
  EmptyState,
  SourceIcon,
} from "../components/shared";
import { sourceName, sourceStatus, shortId, time } from "../lib/presentation";
export function ConnectionsPage({
  data,
  onSelect,
  onTask,
}: {
  data: Overview;
  onSelect: (selection: Selection) => void;
  onTask: (id: string) => void;
}) {
  useLocale();
  const [source, setSource] = useState("");
  const [messages, setMessages] = useState<InboundMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const loading = loadedKey !== `${source}:${offset}`;
  useEffect(() => {
    let cancelled = false;
    api
      .messages(source, offset)
      .then((r) => {
        if (!cancelled) {
          setMessages(r.messages);
          setTotal(r.total);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadedKey(`${source}:${offset}`);
      });
    return () => {
      cancelled = true;
    };
  }, [source, offset, data.generatedAt]);
  return (
    <>
      <PageHeading
        eyebrow="MESSAGE CONNECTIONS"
        title={tr("connections.title")}
        description={tr(
          "connections.description",
        )}
      />
      <div className="connections-grid">
        {data.sources.map((s) => (
          <button
            className={`connection-card ${s.transport === "available" ? "available" : ""}`}
            key={s.id}
            onClick={() => onSelect({ kind: "source", id: s.id })}
          >
            <div>
              <span className={`object-icon source-${s.id}`}>
                <SourceIcon source={s.id} size={25} />
              </span>
              <ArrowUpRightIcon size={17} />
            </div>
            <h2>{sourceName(s.id) ?? s.id}</h2>
            <p>
              {s.id === "console"
                ? tr("connections.consoleDesc")
                : s.id === "feishu"
                  ? tr("connections.feishuDesc")
                  : s.id === "github"
                    ? tr("connections.githubDesc")
                    : s.id === "webhook"
                      ? tr("connections.webhookDesc")
                      : tr("connections.otherDesc")}
            </p>
            <div className="connection-status">
              <span>
                <i
                  className={`state-dot ${s.transport === "available" ? "running" : ""}`}
                />
                {sourceStatus(s)}
              </span>
              <span>
                {s.count}
                {" "}{tr("connections.countEvents")}
              </span>
            </div>
          </button>
        ))}
      </div>
      <section className="panel messages-panel">
        <SectionTitle
          title={tr("connections.inbox")}
          meta={tr("connections.inboxMeta")}
        />
        <div className="tab-bar message-tabs">
          <button
            className={!source ? "active" : ""}
            onClick={() => {
              setSource("");
              setOffset(0);
            }}
          >
            {tr("common.allSources")}{" "}
          </button>
          {data.sources.map((s) => (
            <button
              className={source === s.id ? "active" : ""}
              key={s.id}
              onClick={() => {
                setSource(s.id);
                setOffset(0);
              }}
            >
              <SourceIcon source={s.id} size={15} />
              {sourceName(s.id) ?? s.id}
            </button>
          ))}
        </div>
        {error && <div className="error-banner">{error}</div>}
        {!messages.length ? (
          <EmptyState
            title={loading ? tr("connections.loading") : tr("connections.emptySource")}
          >
            {tr("connections.emptyHint")}{" "}
          </EmptyState>
        ) : (
          <div className="message-list">
            {messages.map((m) => (
              <div className="message-row" key={m.id}>
                <span className={`message-avatar source-${m.source}`}>
                  <SourceIcon source={m.source} size={20} />
                </span>
                <div className="message-body">
                  <div className="message-meta">
                    <b>{sourceName(m.source) ?? m.source}</b>
                    <span>{m.actorId ?? tr("connections.externalSender")}</span>
                    <time>{time(m.createdAt, true)}</time>
                  </div>
                  <p>{m.preview}</p>
                  <div className="message-route">
                    <code title={m.threadId ?? m.externalId}>
                      {m.threadId ?? m.externalId}
                    </code>
                    <ArrowRightIcon size={13} />
                    {!m.routes.length ? (
                      <span className="tag">
                        {m.status === "ignored" ? tr("connections.ignored") : tr("connections.unassigned")}
                      </span>
                    ) : (
                      m.routes.map((route) =>
                        route.target === "router" ? (
                          <span className="tag orange" key={route.target}>
                            <ArrowsSplitIcon size={12} />
                            Router
                          </span>
                        ) : (
                          <button
                            className="tag clickable"
                            key={route.target}
                            onClick={() => onTask(route.target)}
                          >
                            <RobotIcon size={12} />
                            Task #{shortId(route.target)}
                            <ArrowUpRightIcon size={11} />
                          </button>
                        ),
                      )
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="list-footer">
          {offset + (messages.length ? 1 : 0)}–{offset + messages.length} /{" "}
          {total}
          {" "}{tr("connections.countMessages")}{" "}
          <div className="pagination">
            <Button
              variant="outline"
              size="sm"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 100))}
            >
              {tr("connections.prevPage")}{" "}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + messages.length >= total}
              onClick={() => setOffset(offset + 100)}
            >
              {tr("connections.nextPage")}{" "}
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
