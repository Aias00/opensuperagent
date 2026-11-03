import { t as tr, useLocale } from "../i18n";
import { sourceName, sourceStatus } from "../lib/presentation";
import { memo, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  MarkerType,
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  type Node,
  type NodeProps,
  type Edge,
} from "@xyflow/react";
import {
  ArrowsSplitIcon,
  RobotIcon,
  BooksIcon,
  ArrowBendUpLeftIcon,
  PaperPlaneTiltIcon,
  ArrowUpRightIcon,
  ArrowDownIcon,
  ArrowClockwiseIcon,
} from "@phosphor-icons/react";
import type { Overview } from "../api";
import { SourceIcon } from "./shared";
type FlowData = {
  title: string;
  subtitle: string;
  type: string;
  meta?: string;
  active?: boolean;
  disabled?: boolean;
  tags?: string[];
  onOpen?: () => void;
};
type FlowNode = Node<FlowData, "agent">;
const AgentNode = memo(function AgentNode({ data }: NodeProps<FlowNode>) {
  useLocale();
  const Icon =
    data.type === "router"
      ? ArrowsSplitIcon
      : data.type === "worker"
        ? RobotIcon
        : data.type === "skill"
          ? BooksIcon
          : data.type === "delivery"
            ? PaperPlaneTiltIcon
            : null;
  return (
    <div
      className={`flow-node node-${data.type} ${data.disabled ? "node-disabled" : ""}`}
    >
      <Handle type="target" position={Position.Left} id="in" />
      <button
        className="node-button"
        onClick={data.onOpen}
        aria-label={tr("common.view", { v0: data.title })}
      >
        <div className="node-top">
          <span className={`node-icon icon-${data.type}`}>
            {Icon ? (
              <Icon size={21} />
            ) : (
              <SourceIcon source={data.type} size={21} />
            )}
          </span>
          <span className="node-title">
            <strong>{data.title}</strong>
            <small>{data.subtitle}</small>
          </span>
          {data.onOpen && <ArrowUpRightIcon size={15} className="node-open" />}
        </div>
        {data.tags && (
          <div className="node-tags">
            {data.tags.slice(0, 3).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
            {!data.tags.length && <span>{tr("flow.noSkills")}</span>}
          </div>
        )}
        {data.meta && (
          <div className="node-bottom">
            <span className={`state-dot ${data.active ? "running" : ""}`} />
            {data.meta}
          </div>
        )}
      </button>
      <Handle type="source" position={Position.Right} id="out" />
      {data.type === "worker" && (
        <>
          <Handle type="source" position={Position.Bottom} id="feedback" />
          <Handle type="target" position={Position.Top} id="resume" />
        </>
      )}
      {data.type === "router" && (
        <Handle type="source" position={Position.Bottom} id="followup-out" />
      )}
    </div>
  );
});
const nodeTypes = { agent: AgentNode };
function IterationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
}: EdgeProps) {
  useLocale();
  const x = sourceX - 150;
  const path = `M ${sourceX},${sourceY} C ${sourceX},${sourceY + 48} ${x},${sourceY + 48} ${x},${sourceY} L ${x},${targetY} C ${x},${targetY - 48} ${targetX},${targetY - 48} ${targetX},${targetY}`;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <span
          className="iteration-label"
          style={{
            transform: `translate(-100%, -50%) translate(${x - 8}px, ${(sourceY + targetY) / 2}px)`,
          }}
        >
          {tr("flow.eventWake")}{" "}
          <br />
          {tr("flow.nextRun")}{" "}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}
const edgeTypes = { iteration: IterationEdge };
export function FlowCanvas({
  data,
  onNavigate,
  onWorker,
}: {
  data: Overview;
  onNavigate: (page: string) => void;
  onWorker: (id: string) => void;
}) {
  const locale = useLocale();
  const [compact, setCompact] = useState(
    () => matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const { nodes, edges } = useMemo(() => {
    const nodes: FlowNode[] = [];
    const edges: Edge[] = [];
    const recentDefinitions = [...data.definitions]
      .sort((a, b) => {
        const score = (id: string) => {
          const tasks = data.tasks.filter((task) => task.definition.id === id);
          const open = tasks.some((task) =>
            ["active", "pending", "waiting"].includes(task.status),
          );
          const recent = tasks.reduce(
            (latest, task) => Math.max(latest, Date.parse(task.updatedAt)),
            0,
          );
          return { open: Number(open), recent };
        };
        const left = score(a.id),
          right = score(b.id);
        return (
          right.open - left.open ||
          right.recent - left.recent ||
          Number(b.id === "coding") - Number(a.id === "coding") ||
          a.id.localeCompare(b.id)
        );
      })
      .slice(0, 3);
    const definitions = recentDefinitions.length
      ? recentDefinitions
      : [
          {
            id: "empty",
            description: tr("flow.importWorker"),
            skills: [] as string[],
          },
        ];
    const workerHeight = Math.max(360, definitions.length * 145);
    const center = workerHeight / 2;
    const node = (id: string, x: number, y: number, d: FlowData) =>
      nodes.push({ id, type: "agent", position: { x, y }, data: d });
    const edge = (
      id: string,
      from: string,
      to: string,
      opts: Partial<Edge> = {},
    ) =>
      edges.push({
        id,
        source: from,
        target: to,
        type: "smoothstep",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 15,
          height: 15,
          color: "#c5c9cc",
        },
        style: { stroke: "#c5c9cc", strokeWidth: 1.4 },
        ...opts,
      });
    data.sources.slice(0, 5).forEach((source, i) => {
      node(source.id, 0, i * 100, {
        type: source.id,
        title: sourceName(source.id, locale) ?? source.id,
        subtitle:
          source.transport === "available"
            ? tr("common.messageChannel")
            : tr("flow.externalSource"),
        meta:
          source.transport === "available"
            ? tr("flow.messagesIn", { v0: source.count })
            : sourceStatus(source),
        disabled: source.transport !== "available",
        onOpen: () => onNavigate("connections"),
      });
      edge(`${source.id}-router`, source.id, "router", {
        animated: source.id === "console" && data.router.active,
        style: {
          stroke: source.id === "console" ? "#d5a18e" : "#d4d7da",
          strokeDasharray: source.id === "console" ? undefined : "4 5",
        },
      });
    });
    node("router", 290, center - 58, {
      type: "router",
      title: "Router",
      subtitle: data.router.model,
      meta: data.router.active
        ? tr("flow.assigning")
        : tr("flow.routerMeta", {
            v0: data.router.runs.length,
            v1: data.router.queued,
          }),
      active: data.router.active,
      onOpen: () => onNavigate("router"),
    });
    definitions.forEach((definition, i) => {
      const tasks = data.tasks.filter((t) => t.definition.id === definition.id);
      const active = tasks.filter((t) =>
        ["active", "pending", "waiting"].includes(t.status),
      ).length;
      const y = center - (definitions.length * 145) / 2 + i * 145 + 15;
      node(`worker-${definition.id}`, 610, y, {
        type: "worker",
        title: definition.id === "empty" ? "Worker" : definition.id,
        subtitle: "Worker",
        meta: tr("flow.workerMeta", {
          v0: active,
          v1: tasks.length,
        }),
        active: active > 0,
        onOpen: () => onWorker(definition.id),
      });
      node(`skills-${definition.id}`, 925, y + 12, {
        type: "skill",
        title: "Skills",
        subtitle: tr("flow.skillMeta"),
        tags: definition.skills,
        onOpen: () => onNavigate("skills"),
      });
      edge(`dispatch-${i}`, "router", `worker-${definition.id}`, {
        label: i === 0 ? tr("flow.dispatch") : undefined,
        animated: data.router.active,
        style: { stroke: "#d48c74", strokeWidth: 1.6 },
      });
      edge(`skill-${i}`, `worker-${definition.id}`, `skills-${definition.id}`, {
        label: tr("flow.reference"),
        style: { stroke: "#baa373", strokeDasharray: "4 4" },
      });
      edge(`return-${i}`, "router", `worker-${definition.id}`, {
        sourceHandle: "followup-out",
        targetHandle: "resume",
        label: i === 0 ? tr("flow.followup") : undefined,
        style: { stroke: "#86aaa3", strokeDasharray: "5 5" },
      });
      // Background operation completion resumes the same Worker, bypassing Router.
      edge(
        `iterate-${i}`,
        `worker-${definition.id}`,
        `worker-${definition.id}`,
        {
          sourceHandle: "feedback",
          targetHandle: "resume",
          type: "iteration",
          animated: active > 0,
          style: { stroke: "#729c92", strokeDasharray: "4 4" },
        },
      );
    });
    node("delivery", 290, workerHeight - 20, {
      type: "delivery",
      title: "Delivery",
      subtitle: tr("flow.deliverySubtitle"),
      meta: tr("flow.deliveryMeta", { v0: data.stats.completed }),
      onOpen: () => onNavigate("connections"),
    });
    definitions.forEach((d, i) =>
      edge(`delivery-${i}`, `worker-${d.id}`, "delivery", {
        sourceHandle: "feedback",
        label: i === 0 ? "_submit_result" : undefined,
        style: { stroke: "#94a8a0" },
      }),
    );
    return { nodes, edges };
  }, [data, onNavigate, onWorker, locale]);
  if (compact)
    return (
      <div className="mobile-flow">
        <div className="mobile-sources">
          {data.sources.slice(0, 4).map((source) => (
            <button key={source.id} onClick={() => onNavigate("connections")}>
              <SourceIcon source={source.id} size={16} />
              <b>{sourceName(source.id, locale) ?? source.id}</b>
              <span>
                {source.transport === "available"
                  ? tr("flow.messagesCount", { v0: source.count })
                  : sourceStatus(source)}
              </span>
            </button>
          ))}
        </div>
        <div className="mobile-flow-arrow">
          <ArrowDownIcon size={17} />
          {tr("flow.routerStep")}{" "}
        </div>
        <button className="mobile-router" onClick={() => onNavigate("router")}>
          <span className="node-icon icon-router">
            <ArrowsSplitIcon size={20} />
          </span>
          <span>
            <strong>Router</strong>
            <small>
              {data.router.runs.length}
              {" "}{tr("flow.routerRoundsSuffix")}{" "}
              {data.router.active ? tr("flow.dispatching") : tr("common.waitingRequest")}
            </small>
          </span>
          <ArrowUpRightIcon size={16} />
        </button>
        <div className="mobile-flow-arrow">
          <ArrowDownIcon size={17} />
          {tr("flow.dispatchStep")}{" "}
        </div>
        <div className="mobile-workers">
          {data.definitions.map((worker) => (
            <div key={worker.id}>
              <button onClick={() => onWorker(worker.id)}>
                <RobotIcon size={18} />
                <strong>{worker.id}</strong>
                <span>
                  {
                    data.tasks.filter(
                      (t) =>
                        t.definition.id === worker.id &&
                        ["active", "waiting", "pending"].includes(t.status),
                    ).length
                  }{" "}
                  {tr("common.inProgress")}{" "}
                </span>
                <ArrowUpRightIcon size={14} />
              </button>
              <div>
                <span>
                  <ArrowClockwiseIcon size={13} />
                  {tr("flow.wakeNext")}{" "}
                </span>
                <button onClick={() => onNavigate("skills")}>
                  <BooksIcon size={13} />
                  {worker.skills.length} Skills
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mobile-flow-arrow">
          <ArrowDownIcon size={17} />
          _submit_result
        </div>
        <button
          className="mobile-delivery"
          onClick={() => onNavigate("connections")}
        >
          <PaperPlaneTiltIcon size={19} />
          <strong>Delivery</strong>
          <span>{tr("flow.deliverySubtitle")}</span>
          <ArrowUpRightIcon size={15} />
        </button>
      </div>
    );
  return (
    <div className="flow-canvas">
      {data.definitions.length > 3 && (
        <button
          className="canvas-catalog-link"
          onClick={() => onNavigate("workers")}
        >
          {tr("flow.catalogLink", {
            v0: data.definitions.length,
          })}
          <ArrowUpRightIcon size={13} />
        </button>
      )}
      <ReactFlow
        ariaLabelConfig={{
          "controls.ariaLabel": tr("flow.canvasControls"),
          "controls.zoomIn.ariaLabel": tr("flow.zoomIn"),
          "controls.zoomOut.ariaLabel": tr("flow.zoomOut"),
          "controls.fitView.ariaLabel": tr("flow.fitView"),
          "handle.ariaLabel": tr("flow.handlePoint"),
        }}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.11 }}
        minZoom={0.35}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: false }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={19}
          size={1}
          color="#dce0df"
        />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div className="canvas-caption">
        <ArrowBendUpLeftIcon size={15} />
        <span>{tr("flow.followupCaption")}</span>
      </div>
      <div className="canvas-legend">
        <span>
          <i className="legend-orange" />
          {tr("flow.legendDispatch")}{" "}
        </span>
        <span>
          <i className="legend-green" />
          {tr("flow.legendIterate")}{" "}
        </span>
        <span>
          <i className="legend-dashed" />
          {tr("flow.legendSkills")}{" "}
        </span>
      </div>
    </div>
  );
}
