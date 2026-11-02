import { t as tr, useLocale } from "../i18n";
import type { ReactNode } from "react";
import {
  ArrowUpRightIcon,
  CheckCircleIcon,
  ClockIcon,
  CircleNotchIcon,
  XCircleIcon,
  TerminalWindowIcon,
  GithubLogoIcon,
  PaperPlaneTiltIcon,
  WebhooksLogoIcon,
  PlugsIcon,
} from "@phosphor-icons/react";
import type { JournalEvent, TaskStatus } from "../api";
import { Button } from "./ui/button";
import { statusLabels, shortId, time } from "../lib/presentation";
export function SourceIcon({
  source,
  size = 18,
}: {
  source: string;
  size?: number;
}) {
  useLocale();
  const Icon =
    source === "console"
      ? TerminalWindowIcon
      : source === "github"
        ? GithubLogoIcon
        : source === "feishu"
          ? PaperPlaneTiltIcon
          : source === "webhook"
            ? WebhooksLogoIcon
            : PlugsIcon;
  return <Icon size={size} />;
}
export function Status({ status }: { status: TaskStatus }) {
  useLocale();
  const Icon =
    status === "completed"
      ? CheckCircleIcon
      : status === "failed"
        ? XCircleIcon
        : status === "active"
          ? CircleNotchIcon
          : ClockIcon;
  return (
    <span className={`status status-${status}`}>
      <Icon size={14} className={status === "active" ? "spin" : ""} />
      {tr(statusLabels[status])}
    </span>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  useLocale();
  return (
    <div className="empty-state">
      <div className="empty-glyph">
        <PlugsIcon size={24} />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  useLocale();
  return (
    <div className="page-heading">
      <div>
        <div className="page-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{tr(description)}</p>
      </div>
      {action}
    </div>
  );
}
export function SectionTitle({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  useLocale();
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {meta && <span>{meta}</span>}
      </div>
      {action}
    </div>
  );
}
export function EventFeed({
  events,
  onTask,
  compact = false,
}: {
  events: JournalEvent[];
  onTask: (id: string) => void;
  compact?: boolean;
}) {
  useLocale();
  const visible = events
    .filter((e) => !["pump", "tool_result"].includes(e.kind))
    .slice(0, compact ? 7 : 60);
  if (!visible.length)
    return (
      <EmptyState title={tr("shared.noActivity")}>
        {tr("shared.noActivityHint")}{" "}
      </EmptyState>
    );
  return (
    <div className={`event-feed ${compact ? "compact" : ""}`}>
      {visible.map((event) => {
        const isTask = event.scope.startsWith("task_");
        const isRouter = event.scope === "router";
        return (
          <div className="event-row" key={event.id}>
            <span
              className={`event-mark ${isRouter ? "orange" : isTask ? "teal" : "gray"}`}
            >
              {isRouter ? "R" : isTask ? "W" : "S"}
            </span>
            <div className="event-copy">
              <div className="event-meta">
                <b>{isRouter ? "Router" : isTask ? "Worker" : "System"}</b>
                <time>{time(event.createdAt)}</time>
              </div>
              <p title={event.summary}>{event.summary}</p>
              {isTask && (
                <Button
                  variant="link"
                  className="event-task"
                  onClick={() => onTask(event.scope)}
                >
                  #{shortId(event.scope)} <ArrowUpRightIcon size={12} />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
