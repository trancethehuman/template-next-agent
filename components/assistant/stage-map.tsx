"use client";

import type { ReactNode } from "react";
import {
  CalendarCheckIcon,
  CheckIcon,
  CircleAlertIcon,
  DatabaseIcon,
  FileTextIcon,
  FlagIcon,
  InboxIcon,
  LightbulbIcon,
  MessageSquareTextIcon,
  MoonIcon,
  ShieldCheckIcon,
  SquareIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import type {
  StageId,
  StageMapView,
  StageState,
  StageView,
} from "@/lib/assistant/stage-map";
import { cn } from "@/lib/utils";

const stageIcons: Record<StageId, typeof ZapIcon> = {
  start: ZapIcon,
  read: DatabaseIcon,
  notice: LightbulbIcon,
  prepare: FileTextIcon,
  review: ShieldCheckIcon,
  deliver: InboxIcon,
  watch: MoonIcon,
  create: CalendarCheckIcon,
  finish: FlagIcon,
};

/** Finished stages swap their icon for the outcome. */
const outcomeIcons: Partial<Record<StageState, typeof ZapIcon>> = {
  done: CheckIcon,
  declined: XIcon,
  stopped: SquareIcon,
  failed: CircleAlertIcon,
};

/** The stages the meeting loop repeats after Watch. */
const loopStages = new Set<StageId>(["read", "notice", "prepare", "review", "deliver", "watch"]);

const live = new Set<StageState>(["active", "next", "waiting", "sleeping", "paused"]);
const reached = new Set<StageState>([
  ...live,
  "done",
  "declined",
  "stopped",
  "failed",
]);

function circleClass(state: StageState) {
  switch (state) {
    case "waiting":
      return "border-primary bg-primary text-primary-foreground ring-4 ring-primary/15";
    case "active":
      return "border-signal bg-signal text-signal-foreground ring-4 ring-signal/20";
    case "next":
    case "paused":
      return "border-foreground bg-background text-foreground ring-4 ring-foreground/10";
    case "sleeping":
      return "border-foreground/40 bg-secondary text-foreground ring-4 ring-foreground/5";
    case "done":
    case "declined":
    case "stopped":
      return "border-foreground bg-foreground text-background";
    case "failed":
      return "border-destructive bg-background text-destructive";
    case "skipped":
      return "border-dashed bg-background text-muted-foreground";
    default:
      return "bg-background text-muted-foreground";
  }
}

function connectorClass(from: StageView, to: StageView) {
  if (to.state === "active") return "assistant-flow-line-vertical";
  if (reached.has(to.state) && reached.has(from.state)) return "bg-foreground/50";
  return "bg-border";
}

/** One line per stage: what it will do, what it is doing, or what it recorded. */
function stageLine(stage: StageView, map: StageMapView, pausesHere: boolean) {
  if (pausesHere) return "Playback pauses here";
  if (live.has(stage.state))
    return stage.id === "watch" && map.maxChecks !== undefined
      ? `${stage.stateLabel} · check ${map.checks} of ${map.maxChecks}`
      : stage.stateLabel;
  if (stage.state === "upcoming") return stage.summary;
  return stage.fact ?? stage.stateLabel;
}

export interface FlowRequest {
  label: string;
  text: string;
  /** Rendered time, when the request has one. */
  time?: ReactNode;
}

/**
 * A top-down diagram of one request moving through the agent loop. Facts
 * come from recorded checkpoints only; stages ahead show what they will do.
 */
export function FlowDiagram({
  map,
  request,
  selectedStageId,
  pauseStageId,
  onSelectStage,
  stageAction,
}: {
  map: StageMapView;
  request?: FlowRequest;
  selectedStageId?: StageId;
  /** The stage playback will pause before, as recorded by the run. */
  pauseStageId?: StageId;
  onSelectStage?: (stage: StageView) => void;
  /** A control for one stage, shown when its row is hovered, focused, or selected. */
  stageAction?: (stage: StageView) => ReactNode;
}) {
  const order = map.stages;
  const loops = map.kind !== "calendar_event";
  const before = loops ? order.filter((stage) => stage.id === "start") : order;
  const loop = loops ? order.filter((stage) => loopStages.has(stage.id)) : [];
  const after = loops ? order.filter((stage) => stage.id === "finish") : [];
  const repeats = `Repeats from ${loop[0]?.label} to ${loop.at(-1)?.label}`;
  const loopLabel =
    map.maxChecks !== undefined
      ? `${repeats} · ${map.checks} of ${map.maxChecks} checks used`
      : repeats;

  const row = (stage: StageView, lastInLoop = false) => {
    const index = order.indexOf(stage);
    const next = order[index + 1];
    const Icon = outcomeIcons[stage.state] ?? stageIcons[stage.id];
    const current = stage.id === map.currentStageId;
    const selected = stage.id === selectedStageId;
    const pausesHere = stage.id === pauseStageId;
    // Once a run is under way, only the stage in focus gets a second line.
    const described = !map.currentStageId || current || selected || pausesHere;
    const action = stageAction?.(stage);
    return (
      <li
        key={stage.id}
        data-stage={stage.id}
        className="group/row relative flex items-start gap-2 pb-5 last:pb-0"
      >
        {next && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute left-5 top-10 w-0.5 -translate-x-1/2",
              lastInLoop ? "-bottom-5" : "bottom-0",
              connectorClass(stage, next),
            )}
          />
        )}
        <button
          type="button"
          disabled={!onSelectStage}
          aria-current={current ? "step" : undefined}
          aria-pressed={onSelectStage ? selected : undefined}
          aria-label={`${index + 1}. ${stage.label}: ${stage.stateLabel}${stage.fact ? `. ${stage.fact}` : ""}`}
          onClick={() => onSelectStage?.(stage)}
          className="group flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={cn(
              "relative flex size-10 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-300 motion-reduce:transition-none",
              circleClass(stage.state),
              selected && "outline-2 outline-offset-4 outline-ring",
            )}
            aria-hidden="true"
          >
            {stage.state === "active" && (
              <span className="absolute inset-0 rounded-full bg-signal opacity-40 motion-safe:animate-ping" />
            )}
            <Icon className="relative size-4" />
          </span>
          <span
            className={cn(
              "flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-1 transition-colors motion-reduce:transition-none",
              !described && "self-center",
              selected ? "bg-muted" : "group-enabled:group-hover:bg-muted/60",
            )}
          >
            <span
              className={cn(
                "text-sm",
                current ? "font-semibold" : "font-medium",
                !reached.has(stage.state) && !current && "text-muted-foreground",
              )}
            >
              {stage.label}
            </span>
            {described && (
              <span
                className={cn(
                  "line-clamp-2 text-xs leading-4",
                  current || pausesHere ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {stageLine(stage, map, pausesHere)}
              </span>
            )}
          </span>
        </button>
        {action && (
          <span
            className={cn(
              "flex shrink-0 items-center pt-1.5",
              !selected && "invisible group-hover/row:visible group-focus-within/row:visible",
            )}
          >
            {action}
          </span>
        )}
      </li>
    );
  };

  return (
    <div className="flex min-w-0 flex-col">
      {request && (
        <>
          <div className="flex flex-col gap-1 rounded-lg border bg-card px-4 py-3">
            <p className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                <MessageSquareTextIcon className="size-3.5" aria-hidden="true" />
                {request.label}
              </span>
              {request.time && (
                <span className="tabular-nums text-muted-foreground">{request.time}</span>
              )}
            </p>
            <p className="line-clamp-3 text-sm leading-6">{request.text}</p>
          </div>
          <span
            aria-hidden="true"
            className={cn(
              "ml-13 h-5 w-0.5 -translate-x-1/2",
              order[0] && reached.has(order[0].state) ? "bg-foreground/50" : "bg-border",
            )}
          />
        </>
      )}
      <ol aria-label="Agent loop stages" className="flex flex-col pl-8">
        {before.map((stage) => row(stage))}
        {loop.length > 0 && (
          <li className="relative pb-5 last:pb-0">
            <span
              aria-hidden="true"
              className={cn(
                "absolute -left-7 bottom-10 top-5 w-6 rounded-l-xl border-y-2 border-l-2 border-dashed transition-colors duration-300 motion-reduce:transition-none",
                map.looping ? "border-signal" : "border-border",
              )}
            >
              <span
                className={cn(
                  "absolute -right-1 -top-1 size-2.5 rotate-45 border-r-2 border-t-2",
                  map.looping ? "border-signal" : "border-border",
                )}
              />
            </span>
            <ol aria-label={loopLabel} className="flex flex-col">
              {loop.map((stage, index) => row(stage, index === loop.length - 1))}
            </ol>
          </li>
        )}
        {after.map((stage) => row(stage))}
      </ol>
    </div>
  );
}

/** A compact stage strip for previews. */
export function StageStrip({ map }: { map: StageMapView }) {
  const current = map.stages.find((stage) => stage.id === map.currentStageId);
  return (
    <div className="flex flex-col gap-2">
      <ol aria-label="Agent loop stages" className="flex items-center gap-1">
        {map.stages.map((stage) => (
          <li
            key={stage.id}
            className="flex min-w-0 flex-1 flex-col gap-1"
            aria-label={`${stage.label}: ${stage.stateLabel}`}
            aria-current={stage.id === map.currentStageId ? "step" : undefined}
          >
            <span
              className={cn(
                "h-1.5 rounded-full transition-colors duration-300 motion-reduce:transition-none",
                stage.state === "active"
                  ? "bg-signal motion-safe:animate-pulse"
                  : stage.state === "waiting" || stage.state === "next" || stage.state === "paused"
                    ? "bg-foreground"
                    : stage.state === "failed"
                      ? "bg-destructive"
                      : stage.state === "done" || stage.state === "declined" || stage.state === "stopped"
                        ? "bg-foreground/40"
                        : stage.state === "sleeping"
                          ? "bg-foreground/20"
                          : "bg-border",
              )}
            />
          </li>
        ))}
      </ol>
      {current && (
        <p className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate font-medium">{current.label}</span>
          <span className="shrink-0 text-muted-foreground">{current.stateLabel}</span>
        </p>
      )}
    </div>
  );
}
