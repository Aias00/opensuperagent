import { t as tr, useLocale } from "../i18n";
import { useState } from "react";
import type { Overview } from "../api";
import {
  BooksIcon,
  RobotIcon,
  ArrowUpRightIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { Button } from "../components/ui/button";
import { PageHeading, EmptyState } from "../components/shared";
export function SkillsPage({
  data,
  onSkill,
  onWorker,
}: {
  data: Overview;
  onSkill: (id: string) => void;
  onWorker: (id: string) => void;
}) {
  useLocale();
  const [search, setSearch] = useState("");
  const skills = data.skills.filter((s) =>
    `${s.name} ${s.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="SKILL LIBRARY"
        title={tr("skills.title")}
        description={tr(
          "skills.description",
        )}
        action={
          <span className="subtle-tag">
            <BooksIcon size={15} />
            {data.skills.length}
            {" "}{tr("skills.count")}{" "}
          </span>
        }
      />
      <section className="panel">
        <div className="list-toolbar">
          <div className="search-input">
            <MagnifyingGlassIcon size={17} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr("skills.searchPlaceholder")}
              aria-label={tr("skills.search")}
            />
          </div>
          <span className="muted">
            {tr("skills.toolbarMeta")}
          </span>
        </div>
        <div className="skills-list">
          {skills.map((skill) => {
            const workers = data.definitions.filter((d) =>
              d.skills.includes(skill.name),
            );
            return (
              <div className="skill-row" key={skill.name}>
                <button
                  className="skill-main"
                  onClick={() => onSkill(skill.name)}
                >
                  <span className="object-icon gold">
                    <BooksIcon size={24} />
                  </span>
                  <span>
                    <strong>{skill.name}</strong>
                    <p>{tr(skill.description)}</p>
                  </span>
                </button>
                <div className="skill-references">
                  <small>
                    {workers.length}
                    {" "}{tr("skills.countWorkerRefs")}
                  </small>
                  <div>
                    {workers.map((w) => (
                      <button key={w.id} onClick={() => onWorker(w.id)}>
                        <RobotIcon size={13} />
                        {w.id}
                      </button>
                    ))}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={tr("common.view", { v0: skill.name })}
                  onClick={() => onSkill(skill.name)}
                >
                  <ArrowUpRightIcon />
                </Button>
              </div>
            );
          })}
        </div>
        {!skills.length && (
          <EmptyState title={tr("skills.noMatch")}>
            {tr("skills.noMatchHint")}{" "}
          </EmptyState>
        )}
      </section>
      <div className="architecture-note">
        <BooksIcon size={22} />
        <div>
          <h3>{tr("skills.noteTitle")}</h3>
          <p>
            {tr("skills.noteBody")}{" "}
          </p>
        </div>
      </div>
    </>
  );
}
