"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  ArrowDownToLineIcon,
  ChevronDownIcon,
  DatabaseIcon,
  HistoryIcon,
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
  PlugIcon,
  RotateCcwIcon,
  MailIcon,
  ShieldCheckIcon,
  SkipForwardIcon,
  SquareIcon,
  UnplugIcon,
  XIcon,
} from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { CalloutList, NextCheckLine } from "@/components/assistant/calendar-watch";
import { FlowDiagram } from "@/components/assistant/stage-map";
import { CalendarDraft } from "@/components/assistant/task-detail";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  projectTaskFlow,
  type TaskFlowPresentation,
  type TaskFlowStep,
} from "@/lib/assistant/flow-presentation";
import {
  runShortcut,
  runTransport,
  shortcutTargetAllowed,
  type LiveTone,
  type RunShortcut,
  type RunTransport,
} from "@/lib/assistant/run-transport";
import {
  playTargets,
  projectStageMap,
  stageLesson,
  type StageId,
  type StageMapView,
  type StageView,
} from "@/lib/assistant/stage-map";
import type {
  AssistantDemoStop,
  AssistantTask,
  TaskAction,
} from "@/lib/assistant/types";
import { cn } from "@/lib/utils";

const terminal = new Set(["completed", "cancelled", "failed"]);

const triggers: { action: TaskAction; label: string; expect: string }[] = [
  { action: "wake", label: "Check now", expect: "Reads the source again." },
  {
    action: "replay",
    label: "Replay the same event",
    expect: "Same version, so no duplicate update.",
  },
  {
    action: "update-source",
    label: "Simulate a meeting change",
    expect: "Moves the meeting to version 2. Expect a new brief.",
  },
  {
    action: "finish",
    label: "Finish monitoring",
    expect: "Ends the run. No more checks.",
  },
];

function clockLabel(value: string) {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function versionLabel(version: string) {
  if (version === "created") return "Provider confirmation";
  return version.length < 18 ? `Version ${version}` : "Snapshot";
}

function toneDot(tone: LiveTone | "offline") {
  switch (tone) {
    case "live":
      return "bg-signal";
    case "waiting":
      return "bg-foreground";
    case "idle":
      return "bg-foreground/40";
    case "failed":
      return "bg-destructive";
    default:
      return "bg-muted-foreground";
  }
}

/** A control with its keyboard shortcut in a tooltip instead of on screen. */
function WithKeys({
  keys,
  label,
  render,
  children,
}: {
  keys: string[];
  label: string;
  render: ReactElement;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={render}>{children}</TooltipTrigger>
      <TooltipContent>
        {label}
        {keys.map((key) => (
          <kbd
            key={key}
            data-slot="kbd"
            className="border border-background/30 px-1 font-mono"
          >
            {key}
          </kbd>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

function LiveStatus({
  transport,
  offline,
  className,
}: {
  transport: RunTransport;
  offline: boolean;
  className?: string;
}) {
  const tone = offline ? "offline" : transport.live.tone;
  return (
    <p
      className={cn("flex min-w-0 items-center gap-2 text-sm font-medium", className)}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
        {(tone === "live" || tone === "idle") && (
          <span
            className={cn(
              "absolute inline-flex size-full rounded-full opacity-60",
              toneDot(tone),
              tone === "live" ? "motion-safe:animate-ping" : "motion-safe:animate-pulse",
            )}
          />
        )}
        <span className={cn("relative inline-flex size-2.5 rounded-full", toneDot(tone))} />
      </span>
      <span className="truncate">
        {offline
          ? "Disconnected · the run keeps going on the server"
          : transport.live.label}
      </span>
    </p>
  );
}

function SourceList({ step }: { step: TaskFlowStep }) {
  const sources = step.event?.sources ?? [];
  if (!sources.length) return null;
  return (
    <ul className="flex flex-col divide-y rounded-lg border" aria-label="Sources at this step">
      {sources.map((source) => {
        const change = step.sourceChanges.find((item) => item.id === source.id);
        return (
          <li
            key={source.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
          >
            <DatabaseIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {source.url ? (
              <a
                className="min-w-0 flex-1 break-words underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                {source.title}
              </a>
            ) : (
              <span className="min-w-0 flex-1 break-words">{source.title}</span>
            )}
            <span className="text-xs tabular-nums text-muted-foreground">
              {versionLabel(source.version)}
            </span>
            {change && (
              <Badge variant={change.changed ? "default" : "outline"}>
                {change.changed
                  ? `Changed from ${change.previousVersion ?? "earlier"}`
                  : change.previousVersion
                    ? "Unchanged"
                    : "First read"}
              </Badge>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MemoryPanel({
  task,
  flow,
  map,
}: {
  task: AssistantTask;
  flow: TaskFlowPresentation;
  map: StageMapView;
}) {
  const lastVersion = (type: "source" | "notification") => {
    const source = task.events.filter((event) => event.type === type).at(-1)?.sources?.[0];
    return source ? versionLabel(source.version) : undefined;
  };
  const decision = task.events.filter((event) => event.type === "approval").at(-1);
  if (task.kind === "calendar_watch") {
    const notice = task.events.findLast((event) => event.callouts);
    return (
      <MemoryRows
        task={task}
        rows={[
          ["Checks used", map.maxChecks !== undefined ? `${map.checks} of ${map.maxChecks}` : String(map.checks)],
          ["Messages sent", String(task.notificationCount)],
          ["Flagged now", notice?.callouts ? String(notice.callouts.length) : "Nothing yet"],
          ["Already sent, not repeated", String(notice?.callouts?.filter((callout) => !callout.fresh).length ?? 0)],
        ]}
      />
    );
  }
  const rows: [string, string][] = [
    ...(task.kind === "meeting_prep"
      ? ([
          ["Checks used", map.maxChecks !== undefined ? `${map.checks} of ${map.maxChecks}` : String(map.checks)],
          ["Last read", lastVersion("source") ?? "Not yet"],
          ["Last delivered", lastVersion("notification") ?? "Nothing yet"],
          ["Inbox updates", String(task.notificationCount)],
          ["Duplicates prevented", String(flow.deduplicatedCount)],
        ] satisfies [string, string][])
      : ([
          ["Event", task.calendarEvent ? (task.calendarEvent.reused ? "Existing event confirmed" : "Created") : "Not created"],
        ] satisfies [string, string][])),
    [
      "Approval",
      decision
        ? decision.title
        : task.status === "awaiting_approval"
          ? "Waiting for you"
          : "None yet",
    ],
  ];
  return <MemoryRows task={task} rows={rows} />;
}

function MemoryRows({ task, rows }: { task: AssistantTask; rows: [string, string][] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Saved in the workflow, not in this page.
      </p>
      <dl className="flex flex-col divide-y rounded-lg border text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4 px-3 py-2">
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words text-right font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="break-all font-mono text-xs text-muted-foreground">{task.runId}</p>
    </div>
  );
}

export function RunViewer({
  task,
  loading,
  loadError,
  onRetry,
  onAction,
  pending,
  error,
  controlNotice,
  onRestart,
  restartPending = false,
  restartError,
  restartEventId,
  restartNotice,
  initialStepId,
  onOpenSource,
  offline,
  onOfflineChange,
  syncedAt,
  active,
}: {
  task?: AssistantTask;
  loading: boolean;
  loadError?: string;
  onRetry: () => void;
  onAction: (runId: string, action: TaskAction, stopAt?: AssistantDemoStop) => void;
  pending: boolean;
  error?: string;
  controlNotice?: string;
  onRestart?: (runId: string, eventId: string) => void;
  restartPending?: boolean;
  restartError?: string;
  restartEventId?: string;
  restartNotice?: string;
  initialStepId?: string;
  onOpenSource?: (runId: string, stepId?: string) => void;
  offline: boolean;
  onOfflineChange: (offline: boolean) => void;
  /** Time of the last successful refresh of this run. */
  syncedAt?: number;
  /** Shortcuts only listen while this view is visible. */
  active: boolean;
}) {
  // Undefined follows the newest checkpoint; a chosen ID stays put while polling.
  const [inspectedId, setInspectedId] = useState<string | undefined>(initialStepId);
  // A stage chosen before it has run: the panel explains it instead of a step.
  const [previewStageId, setPreviewStageId] = useState<StageId>();
  const [away, setAway] = useState<{
    stepCount: number;
    returnedAt?: number;
    /** Steps known at the first refresh after reconnecting. */
    caughtUpCount?: number;
  }>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const stepListRef = useRef<HTMLOListElement>(null);

  const flow = task ? projectTaskFlow(task, { now: syncedAt }) : undefined;
  const map = task && flow ? projectStageMap(task, flow) : undefined;
  const transport = task ? runTransport(task) : undefined;
  const steps = flow?.steps ?? [];
  const following = !inspectedId || !steps.some((step) => step.id === inspectedId);
  const selected = following ? steps.at(-1) : steps.find((step) => step.id === inspectedId);
  const selectedIndex = selected ? steps.indexOf(selected) : -1;
  const selectedStageId = selected && map ? map.stepStages[selected.id] : undefined;
  const controlsDisabled = pending || loading || Boolean(loadError) || restartPending || offline;
  const restartDisabled =
    pending || loading || Boolean(loadError) || restartPending || Boolean(restartError) || offline;
  // Freeze the catch-up count at the first refresh after reconnecting.
  if (
    away?.returnedAt !== undefined &&
    away.caughtUpCount === undefined &&
    syncedAt !== undefined &&
    syncedAt >= away.returnedAt
  )
    setAway({ ...away, caughtUpCount: steps.length });
  const caughtUpCount = away?.caughtUpCount;
  const caughtUp = caughtUpCount !== undefined;
  const missedCount =
    away && caughtUpCount !== undefined ? Math.max(0, caughtUpCount - away.stepCount) : 0;
  const missedFrom = missedCount > 0 ? away?.stepCount : undefined;
  const isMissed = (index: number) =>
    missedFrom !== undefined && index >= missedFrom && index < missedFrom + missedCount;

  useEffect(() => {
    const list = stepListRef.current;
    const item = list?.querySelector<HTMLElement>(`[data-step="${selected?.id}"]`);
    if (!list || !item) return;
    // The list is positioned, so offsetTop is already relative to it.
    const top = item.offsetTop;
    if (top < list.scrollTop || top + item.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTo({ top: Math.max(0, top - list.clientHeight / 3) });
  }, [selected?.id, historyOpen]);

  const act = (action: TaskAction, stopAt?: AssistantDemoStop) => {
    if (!task || controlsDisabled) return;
    onAction(task.runId, action, stopAt);
  };
  const inspect = (id: string | undefined) => {
    setPreviewStageId(undefined);
    setInspectedId(id);
  };
  const browse = (offset: number) => {
    const target = steps[selectedIndex + offset];
    if (target) inspect(target.id === steps.at(-1)?.id ? undefined : target.id);
  };

  const handleShortcut = useEffectEvent((shortcut: RunShortcut) => {
    if (shortcut === "previous-step") return browse(-1);
    if (shortcut === "next-step") return browse(1);
    if (shortcut === "live") return inspect(undefined);
    if (shortcut === "toggle" && transport?.toggle) return act(transport.toggle.action);
    if (shortcut === "next" && transport?.next) act(transport.next.action);
  });

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const shortcut = runShortcut(event);
      if (!shortcut || !shortcutTargetAllowed(event.target, event.key)) return;
      event.preventDefault();
      handleShortcut(shortcut);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  if (!task || !flow || !map || !transport) {
    if (loadError)
      return (
        <Alert variant="destructive">
          <AlertTitle>Couldn’t load this run</AlertTitle>
          <AlertDescription>
            <p>{loadError}</p>
            <Button size="sm" variant="outline" disabled={loading} onClick={onRetry}>
              {loading ? "Refreshing…" : "Try again"}
            </Button>
          </AlertDescription>
        </Alert>
      );
    return (
      <div className="flex flex-col gap-4" role="status" aria-label="Loading run">
        <span className="sr-only">Loading the run and its steps…</span>
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const isTerminal = terminal.has(task.status);
  const toggle = transport.toggle;
  const selectedStage = map.stages.find((stage) => stage.id === selectedStageId);
  const allowed = new Set(task.allowedActions);
  const targets = playTargets(task, map);
  // A preview ends once its stage is reached.
  const previewStage = map.stages.find(
    (stage) =>
      stage.id === previewStageId && stage.state === "upcoming" && stage.id !== map.currentStageId,
  );
  const previewTarget = targets.find((id) => id === previewStageId);
  const pauseStageId = task.demo?.playback === "play" ? task.demo.stopAt : undefined;
  const firstGate = !task.events.some((event) => event.demoStage && !event.demoGate);
  // A demo gate's recorded detail repeats the status line, so the gate shows only
  // its title, or how to begin while no stage has run yet.
  const detail = selected?.event?.demoGate
    ? firstGate && following
      ? "The request is in. The agent pauses before every stage. Press Next step to run one stage, or Play to run until it needs you."
      : undefined
    : (selected?.event?.detail ??
      (selected?.origin === "run-status"
        ? selected.state === "failed"
          ? "The durable run reports a failure."
          : selected.state === "stopped"
            ? "The durable run confirms it has stopped."
            : "Reported by the durable run; no checkpoint was recorded for this state."
        : undefined));

  // Starting from a stage replays a rehearsal from that stage's recorded checkpoint.
  const startFromId = (stage: StageView) => {
    if (!onRestart || task.mode !== "rehearsal" || task.kind !== "meeting_prep") return undefined;
    if (stage.state === "upcoming" || stage.id === "finish") return undefined;
    if (stage.id === map.currentStageId && !isTerminal) return undefined;
    return stage.id === "start" ? "beginning" : stage.lastStepId;
  };
  const selectStage = (stage: StageView) => {
    if (stage.id === map.currentStageId) return inspect(undefined);
    if (stage.state === "upcoming" || !stage.lastStepId) {
      setInspectedId(undefined);
      setPreviewStageId(stage.id);
      return;
    }
    inspect(stage.lastStepId === steps.at(-1)?.id ? undefined : stage.lastStepId);
  };
  const stageAction = (stage: StageView) => {
    const target = targets.find((id) => id === stage.id);
    if (target)
      return (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Play to here: ${stage.label}`}
                disabled={controlsDisabled}
                onClick={() => {
                  inspect(undefined);
                  act("play", target);
                }}
              />
            }
          >
            <ArrowDownToLineIcon />
          </TooltipTrigger>
          <TooltipContent>Play to here · pauses before {stage.label}</TooltipContent>
        </Tooltip>
      );
    const eventId = startFromId(stage);
    if (!eventId || !onRestart) return undefined;
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Start from here: ${stage.label}`}
              disabled={restartDisabled}
              onClick={() => onRestart(task.runId, eventId)}
            />
          }
        >
          <RotateCcwIcon />
        </TooltipTrigger>
        <TooltipContent>Start from here · a new run from {stage.label}</TooltipContent>
      </Tooltip>
    );
  };

  const disconnect = () => {
    setAway({ stepCount: steps.length });
    onOfflineChange(true);
  };
  const reconnect = () => {
    setAway((value) => value && { ...value, returnedAt: Date.now() });
    onOfflineChange(false);
  };

  // Only decisions the controls below can't make appear under the step.
  const move = isTerminal ? (
    onRestart && (
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={restartDisabled}
          onClick={() => onRestart(task.runId, "beginning")}
        >
          <RotateCcwIcon data-icon="inline-start" />
          Run it again
        </Button>
        {task.status !== "completed" && task.kind === "meeting_prep" && selected && (
          <Button
            variant="ghost"
            disabled={restartDisabled}
            aria-label={`Start from here: ${selected.label}`}
            onClick={() => onRestart(task.runId, selected.id)}
          >
            Start from here
          </Button>
        )}
      </div>
    )
  ) : task.status === "awaiting_approval" ? (
    <>
      {task.kind === "calendar_event" ? (
        <CalendarDraft task={task} />
      ) : (
        task.brief && (
          <div className="rounded-lg border bg-background p-4 text-sm leading-6">
            <MessageResponse>{task.brief}</MessageResponse>
          </div>
        )
      )}
      <div className="flex flex-wrap gap-2">
        {allowed.has("approve") && (
          <Button size="lg" disabled={controlsDisabled} onClick={() => act("approve")}>
            <ShieldCheckIcon data-icon="inline-start" />
            {task.kind === "calendar_event" ? "Create calendar event" : "Approve delivery"}
          </Button>
        )}
        {allowed.has("deny") && (
          <Button size="lg" variant="outline" disabled={controlsDisabled} onClick={() => act("deny")}>
            Decline
          </Button>
        )}
      </div>
    </>
  ) : task.status === "sleeping" && task.kind !== "calendar_watch" ? (
    <div className="flex flex-wrap gap-2">
      {triggers
        .filter(
          (trigger) => allowed.has(trigger.action) && trigger.action !== transport.next?.action,
        )
        .map((trigger) => (
          <Tooltip key={trigger.action}>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  disabled={controlsDisabled}
                  onClick={() => act(trigger.action)}
                />
              }
            >
              {trigger.label}
            </TooltipTrigger>
            <TooltipContent>{trigger.expect}</TooltipContent>
          </Tooltip>
        ))}
    </div>
  ) : undefined;

  // Next step leads while stepping, and Check now while asleep; Pause leads while playing.
  const nextLeads =
    Boolean(transport.next) && (toggle?.kind !== "pause" || task.status === "sleeping");
  const hasControls = Boolean(toggle || transport.next || transport.stop);

  return (
    <section aria-label="Live run" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="break-words text-xl font-semibold tracking-tight">{task.title}</h2>
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span>
              {task.mode === "rehearsal"
                ? "Synthetic rehearsal"
                : task.kind === "calendar_watch"
                  ? "Your Google Calendar · read-only"
                  : "Google Calendar"}
            </span>
            {task.demo && <span>· Guided demo</span>}
            {task.restart &&
              (onOpenSource ? (
                <button
                  type="button"
                  className="underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    if (task.restart)
                      onOpenSource(
                        task.restart.sourceRunId,
                        task.restart.sourceEventId === "beginning" ? undefined : task.restart.sourceEventId,
                      );
                  }}
                >
                  · Restarted run
                </button>
              ) : (
                <span>· Restarted run</span>
              ))}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={offline}
                  onClick={offline ? reconnect : disconnect}
                />
              }
            >
              {offline ? <PlugIcon data-icon="inline-start" /> : <UnplugIcon data-icon="inline-start" />}
              {offline ? "Reconnect" : "Disconnect viewer"}
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-64">
              {offline
                ? "Get updates again and see what you missed."
                : "Stop checking for updates, like closing the tab. The run keeps going."}
            </TooltipContent>
          </Tooltip>
          {onRestart && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={restartDisabled}
                    onClick={() => onRestart(task.runId, "beginning")}
                  />
                }
              >
                <RotateCcwIcon data-icon="inline-start" />
                Start over
              </TooltipTrigger>
              <TooltipContent side="bottom">Restart from the beginning as a new run</TooltipContent>
            </Tooltip>
          )}
        </div>
      </header>

      {away?.returnedAt !== undefined && !offline && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
        >
          <span className="flex items-center gap-2">
            <PlugIcon className="size-4 shrink-0" aria-hidden="true" />
            {!caughtUp
              ? "Catching up…"
              : missedCount > 0
                ? `${missedCount} new ${missedCount === 1 ? "step" : "steps"} while you were away`
                : "Nothing new while you were away"}
          </span>
          <span className="flex items-center gap-1">
            {missedFrom !== undefined && (
              <Button size="sm" variant="outline" onClick={() => inspect(steps[missedFrom]?.id)}>
                Show what I missed
              </Button>
            )}
            {caughtUp && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Dismiss"
                onClick={() => setAway(undefined)}
              >
                <XIcon />
              </Button>
            )}
          </span>
        </div>
      )}
      {restartNotice && (
        <p className="text-xs leading-5 text-muted-foreground" role="status">
          {restartNotice}
        </p>
      )}
      {controlNotice && (
        <p className="text-xs leading-5 text-muted-foreground" role="status">
          {controlNotice}
        </p>
      )}
      {restartError && (
        <Alert variant="destructive">
          <AlertTitle>Restart not confirmed</AlertTitle>
          <AlertDescription>
            <p>{restartError}</p>
            <p>Retry the same request to recover its new run safely.</p>
            {onRestart && restartEventId && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending || loading || restartPending}
                onClick={() => onRestart(task.runId, restartEventId)}
              >
                Retry restart
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Action not confirmed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>Couldn’t refresh this run</AlertTitle>
          <AlertDescription>
            <p>{loadError}</p>
            <Button size="sm" variant="outline" disabled={loading} onClick={onRetry}>
              {loading ? "Refreshing…" : "Try again"}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {task.error && (
        <Alert variant="destructive">
          <AlertTitle>Task needs attention</AlertTitle>
          <AlertDescription>{task.error}</AlertDescription>
        </Alert>
      )}

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-5">
          <FlowDiagram
            map={map}
            request={{
              label: "Request",
              text: task.prompt || task.title,
              time: <time dateTime={task.createdAt}>{clockLabel(task.createdAt)}</time>,
            }}
            selectedStageId={previewStage?.id ?? (following ? undefined : selectedStageId)}
            pauseStageId={pauseStageId}
            onSelectStage={selectStage}
            stageAction={stageAction}
          />
        </div>
        <article
          aria-label="Selected step"
          className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card lg:sticky lg:top-4 lg:col-span-7"
        >
          <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-6">
            {previewStage ? (
              <>
                <LiveStatus transport={transport} offline={offline} className="sr-only" />
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-1.5 text-xs">
                  <span>Not reached yet</span>
                  <WithKeys
                    keys={["L"]}
                    label="Back to live"
                    render={<Button size="xs" variant="outline" onClick={() => inspect(undefined)} />}
                  >
                    Back to live
                  </WithKeys>
                </div>
                <div
                  key={previewStage.id}
                  className="flex max-w-2xl flex-col gap-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300"
                >
                  <h3 className="text-2xl font-semibold tracking-tight">{previewStage.label}</h3>
                  <p className="leading-7 text-muted-foreground">{previewStage.summary}.</p>
                </div>
                <p className="max-w-2xl rounded-lg bg-muted px-4 py-3 text-sm leading-6">
                  <span className="font-semibold">{previewStage.concept}.</span>{" "}
                  {stageLesson(previewStage.id, task.mode, task.kind)}
                </p>
                {previewTarget && !offline && (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                    disabled={controlsDisabled}
                    onClick={() => {
                      inspect(undefined);
                      act("play", previewTarget);
                    }}
                  >
                      <ArrowDownToLineIcon data-icon="inline-start" />
                      Play to here
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Runs each stage, then pauses before {previewStage.label}.
                    </span>
                  </div>
                )}
              </>
            ) : !selected ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No steps yet</EmptyTitle>
                  <EmptyDescription>The first checkpoint will appear here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                {following ? (
                  <LiveStatus transport={transport} offline={offline} />
                ) : (
                  <>
                    <LiveStatus transport={transport} offline={offline} className="sr-only" />
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-1.5 text-xs">
                      <span className="flex items-center gap-1.5 tabular-nums">
                        <HistoryIcon className="size-3.5 shrink-0" aria-hidden="true" />
                        Earlier step · {selectedIndex + 1} of {steps.length}
                      </span>
                      <span className="flex items-center gap-1">
                        {onRestart && task.kind !== "calendar_watch" && (
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={restartDisabled}
                            aria-label={`Start from here: ${selected.label}`}
                            onClick={() => onRestart(task.runId, selected.id)}
                          >
                            <RotateCcwIcon data-icon="inline-start" />
                            Start from here
                          </Button>
                        )}
                        <WithKeys
                          keys={["L"]}
                          label="Back to live"
                          render={
                            <Button size="xs" variant="outline" onClick={() => inspect(undefined)} />
                          }
                        >
                          Back to live
                        </WithKeys>
                      </span>
                    </div>
                  </>
                )}
                <div
                  key={selected.id}
                  className="flex max-w-2xl flex-col gap-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300"
                >
                  <h3 className="break-words text-2xl font-semibold tracking-tight">
                    {selected.label}
                  </h3>
                  {detail && <p className="leading-7 text-muted-foreground">{detail}</p>}
                </div>

                {selectedStage && (
                  <p className="max-w-2xl rounded-lg bg-muted px-4 py-3 text-sm leading-6">
                    <span className="font-semibold">{selectedStage.concept}.</span>{" "}
                    {stageLesson(selectedStage.id, task.mode, task.kind)}
                  </p>
                )}

                <SourceList step={selected} />
                {selected.event?.type === "deduplicated" && (
                  <p className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm">
                    <ShieldCheckIcon className="size-4 shrink-0" aria-hidden="true" />
                    Seen this version before. Nothing sent.
                  </p>
                )}
                {selected.event?.callouts && <CalloutList callouts={selected.event.callouts} />}
                {selected.event?.nextCheck && <NextCheckLine nextCheck={selected.event.nextCheck} />}
                {selected.event?.content && task.kind === "calendar_watch" ? (
                  <section
                    aria-label="Message to you"
                    className="flex flex-col gap-2 rounded-lg border bg-background p-4 text-sm leading-6"
                  >
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MailIcon className="size-3.5" aria-hidden="true" />
                      From your assistant
                      {selected.occurredAt && <> · {clockLabel(selected.occurredAt)}</>}
                    </p>
                    <MessageResponse>{selected.event.content}</MessageResponse>
                  </section>
                ) : selected.event?.content && (
                  <div
                    className="rounded-lg border bg-background p-4 text-sm leading-6"
                    aria-label={
                      selected.event.type === "notification"
                        ? "Delivered to the inbox"
                        : selected.event.type === "restart"
                          ? "Restored context"
                          : "Output"
                    }
                  >
                    <MessageResponse>{selected.event.content}</MessageResponse>
                  </div>
                )}

                {following && !offline && move && (
                  <section aria-label="Your move" className="flex flex-col gap-3">
                    {move}
                  </section>
                )}
              </>
            )}
          </div>

          {hasControls && (
            <section
              aria-label="Run controls"
              className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-4 py-3 sm:px-6"
            >
              {toggle && (
                <WithKeys
                  keys={["Space"]}
                  label="Play or pause"
                  render={
                    <Button
                      variant={nextLeads ? "outline" : "default"}
                      disabled={controlsDisabled}
                      onClick={() => act(toggle.action)}
                    />
                  }
                >
                  {pending ? (
                    <LoaderCircleIcon className="motion-safe:animate-spin" data-icon="inline-start" />
                  ) : toggle.kind === "pause" ? (
                    <PauseIcon data-icon="inline-start" />
                  ) : (
                    <PlayIcon data-icon="inline-start" />
                  )}
                  {toggle.label}
                </WithKeys>
              )}
              {transport.next && (
                <WithKeys
                  keys={["N"]}
                  label={transport.next.label}
                  render={
                    <Button
                      variant={nextLeads ? "default" : "outline"}
                      disabled={controlsDisabled}
                      onClick={() => transport.next && act(transport.next.action)}
                    />
                  }
                >
                  <SkipForwardIcon data-icon="inline-start" />
                  {transport.next.label}
                </WithKeys>
              )}
              {transport.stop && (
                <Button
                  variant="ghost"
                  disabled={controlsDisabled}
                  onClick={() => transport.stop && act(transport.stop.action)}
                >
                  <SquareIcon data-icon="inline-start" />
                  Stop
                </Button>
              )}
            </section>
          )}
        </article>
      </div>

      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen} className="flex flex-col gap-3">
        <CollapsibleTrigger
          render={<Button variant="ghost" size="sm" className="self-start" />}
        >
          <ChevronDownIcon
            data-icon="inline-start"
            className={cn(
              "transition-transform motion-reduce:transition-none",
              historyOpen && "rotate-180",
            )}
          />
          {historyOpen ? "Hide" : "Show"} all steps and memory
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="flex min-w-0 flex-col gap-2 lg:col-span-3">
              <h3 className="text-sm font-medium">Steps</h3>
              <ol
                ref={stepListRef}
                aria-label="Recorded workflow steps"
                className="relative flex max-h-96 flex-col overflow-y-auto pr-1"
              >
                {steps.map((step, index) => {
                  const isSelected = step.id === selected?.id;
                  const isHead = index === steps.length - 1;
                  return (
                    <li key={step.id} data-step={step.id}>
                      <button
                        type="button"
                        aria-current={isSelected ? "step" : undefined}
                        onClick={() => inspect(isHead ? undefined : step.id)}
                        className={cn(
                          "flex min-h-10 w-full items-center gap-3 rounded-md px-2 text-left outline-none transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                          isSelected && "bg-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",
                            isSelected && "border-foreground bg-foreground text-background",
                            step.state === "failed" && "border-destructive text-destructive",
                          )}
                          aria-hidden="true"
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">{step.label}</span>
                        {isMissed(index) && (
                          <span className="shrink-0 text-xs font-medium text-signal">New</span>
                        )}
                        {isHead && !isTerminal ? (
                          <span className="flex shrink-0 items-center gap-1 text-xs font-medium">
                            <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
                            Live
                          </span>
                        ) : (
                          step.occurredAt && (
                            <time
                              dateTime={step.occurredAt}
                              className="shrink-0 text-xs tabular-nums text-muted-foreground"
                            >
                              {clockLabel(step.occurredAt)}
                            </time>
                          )
                        )}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="flex min-w-0 flex-col gap-2 lg:col-span-2">
              <h3 className="text-sm font-medium">Memory</h3>
              <MemoryPanel task={task} flow={flow} map={map} />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
