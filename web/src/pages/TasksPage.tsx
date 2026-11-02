import { t as tr, useLocale } from "../i18n";
import { useState } from "react";
import type { Overview, Task } from "../api";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowUpRightIcon,
} from "@phosphor-icons/react";
import { Button } from "../components/ui/button";
import { TaskList } from "../components/TaskList";
import { EmptyState, PageHeading } from "../components/shared";
import { sourceName } from "../lib/presentation";
export function TasksPage({
  data,
  onTask,
  onCreate,
}: {
  data: Overview;
  onTask: (id: string) => void;
  onCreate: () => void;
}) {
  useLocale();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [worker, setWorker] = useState("");
  const tabs = [
    { id: "all", label: tr("common.allTasks") },
    { id: "open", label: tr("common.inProgress") },
    { id: "completed", label: tr("status.completed") },
    { id: "failed", label: tr("tasks.tabFailed") },
  ];
  const tabFilter = (task: Task, id: string) =>
    id === "all" ||
    (id === "open"
      ? ["pending", "active", "waiting"].includes(task.status)
      : id === "failed"
        ? ["failed", "cancelled"].includes(task.status)
        : task.status === id);
  const tasks = data.tasks.filter(
    (t) =>
      tabFilter(t, filter) &&
      (!source || t.source === source) &&
      (!worker || t.definition.id === worker) &&
      `${t.id} ${t.objective}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="TASK RUNS"
        title={tr("tasks.title")}
        description={tr(
          "tasks.description",
        )}
        action={
          <Button onClick={onCreate}>
            <PlusIcon />
            {tr("common.newGoal")}{" "}
          </Button>
        }
      />
      <section className="panel">
        <div className="tab-bar task-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={filter === t.id ? "active" : ""}
              onClick={() => setFilter(t.id)}
            >
              {t.label}
              <span>
                {data.tasks.filter((task) => tabFilter(task, t.id)).length}
              </span>
            </button>
          ))}
        </div>
        <div className="list-toolbar">
          <div className="search-input">
            <MagnifyingGlassIcon size={17} />
            <input
              placeholder={tr("tasks.searchPlaceholder")}
              aria-label={tr("shared.searchTasksAria")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="toolbar-filters">
            <FunnelIcon size={15} />
            <select
              aria-label={tr("tasks.filterSource")}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">{tr("common.allSources")}</option>
              {data.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {sourceName(s.id) ?? s.id}
                </option>
              ))}
            </select>
            <select
              aria-label={tr("tasks.filterWorker")}
              value={worker}
              onChange={(e) => setWorker(e.target.value)}
            >
              <option value="">{tr("tasks.filterAllWorkers")}</option>
              {[...new Set(data.tasks.map((t) => t.definition.id))].map(
                (id) => (
                  <option value={id} key={id}>
                    {id}
                  </option>
                ),
              )}
            </select>
          </div>
        </div>
        {tasks.length ? (
          <TaskList tasks={tasks} onTask={onTask} onCreate={onCreate} />
        ) : (
          <EmptyState
            title={data.tasks.length ? tr("tasks.noMatch") : tr("tasks.empty")}
          >
            {data.tasks.length ? (
              tr("tasks.tryOther")
            ) : (
              <Button variant="outline" onClick={onCreate}>
                {tr("common.firstGoal")}{" "}
              </Button>
            )}
          </EmptyState>
        )}
        <div className="list-footer">
          {tr("tasks.showing")}{" "}
          {tasks.length} / {data.tasks.length}
          {" "}{tr("common.count.tasks")}{" "}
          <span>
            {tr("tasks.footerHint")}{" "}
            <ArrowUpRightIcon size={13} />
          </span>
        </div>
      </section>
    </>
  );
}
