import { t as tr, useLocale } from "../i18n";
import type { Task } from "../api";
import { PlusIcon, RobotIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import { Button } from "./ui/button";
import { EmptyState, SourceIcon, Status } from "./shared";
import { sourceName, shortId, time } from "../lib/presentation";
export function TaskList({
  tasks,
  onTask,
  compact = false,
  onCreate,
}: {
  tasks: Task[];
  onTask: (id: string) => void;
  compact?: boolean;
  onCreate: () => void;
}) {
  useLocale();
  if (!tasks.length)
    return (
      <EmptyState title={tr("tasks.readyTitle")}>
        {tr("tasks.readyHint")}{" "}
        <br />
        <Button variant="outline" className="empty-action" onClick={onCreate}>
          <PlusIcon />
          {tr("common.firstGoal")}{" "}
        </Button>
      </EmptyState>
    );
  return (
    <div className={`task-list ${compact ? "task-list-compact" : ""}`}>
      <div className="task-list-head">
        <span>{tr("tasks.colGoal")}</span>
        <span>Worker</span>
        <span>{tr("tasks.colStatus")}</span>
        <span>{tr("tasks.colUpdated")}</span>
        <span />
      </div>
      {tasks.map((task) => (
        <button
          className="task-row"
          key={task.id}
          onClick={() => onTask(task.id)}
        >
          <div className="task-objective">
            <span className="task-source">
              <SourceIcon source={task.source} size={17} />
            </span>
            <div>
              <strong>{task.objective}</strong>
              <small>
                #{shortId(task.id)}
                <span>·</span>
                {task.runCount}
                {" "}{tr("common.count.runs")}
                <span>·</span>
                {sourceName(task.source) ?? task.source}
              </small>
            </div>
          </div>
          <span className="worker-label">
            <RobotIcon size={14} />
            {task.definition.id}
          </span>
          <Status status={task.status} />
          <time>{time(task.updatedAt)}</time>
          <ArrowUpRightIcon size={16} className="row-arrow" />
        </button>
      ))}
    </div>
  );
}
