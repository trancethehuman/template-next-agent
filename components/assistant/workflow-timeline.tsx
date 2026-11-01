"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRightIcon,
  CheckCheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Clock3Icon,
  CircleAlertIcon,
  DatabaseIcon,
  FileTextIcon,
  FlagIcon,
  GitBranchIcon,
  InboxIcon,
  ShieldCheckIcon,
  RotateCcwIcon,
} from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { StageStrip } from "@/components/assistant/stage-map";
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
import {
  projectTaskFlow,
  type TaskFlowStep,
} from "@/lib/assistant/flow-presentation";
import { projectStageMap } from "@/lib/assistant/stage-map";
import type { AssistantTask } from "@/lib/assistant/types";
import { cn } from "@/lib/utils";

const stepIcons = {
  status: GitBranchIcon,
  source: DatabaseIcon,
  brief: FileTextIcon,
  decision: ShieldCheckIcon,
  delivery: InboxIcon,
  wait: Clock3Icon,
  result: CheckCheckIcon,
  terminal: FlagIcon,
  error: CircleAlertIcon,
};

const stateLabels: Partial<Record<TaskFlowStep["state"], string>> = {
  active: "In progress",
  waiting: "Waiting",
  paused: "Paused",
  failed: "Failed",
  denied: "Declined",
  stopped: "Stopped",
};

function durationLabel(milliseconds: number) {
  if (milliseconds < 1_000) return "<1s";
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function StepDetails({
  step,
  showInterval,
}: {
  step: TaskFlowStep;
  showInterval: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 border-l-2 border-primary/20 py-1 pl-4">
      {step.event && step.event.title !== step.label && (
        <p className="text-xs font-medium">{step.event.title}</p>
      )}
      {step.event?.detail && (
        <p className="text-sm leading-6 text-muted-foreground">
          {step.event.detail}
        </p>
      )}
      {step.origin === "run-status" && (
        <p className="text-sm leading-6 text-muted-foreground">
          {step.state === "failed"
            ? "The durable run reports a failure."
            : step.state === "stopped"
              ? "The durable run confirms it has stopped."
              : "Reported by the durable run; no checkpoint was recorded for this state."}
        </p>
      )}
      {Boolean(step.event?.sources?.length) && (
        <ul className="flex flex-col gap-2" aria-label="Sources at this step">
          {step.event?.sources?.map((source) => {
            const change = step.sourceChanges.find(
              (item) => item.id === source.id,
            );
            return (
              <li
                key={source.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
              >
                <DatabaseIcon
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                {source.url ? (
                  <a
                    className="min-w-0 break-words underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.title}
                  </a>
                ) : (
                  <span className="min-w-0 break-words">{source.title}</span>
                )}
                {change && (
                  <Badge variant="outline">
                    {change.changed
                      ? "Changed"
                      : change.previousVersion
                        ? "Unchanged"
                        : "First read"}
                  </Badge>
                )}
                <span className="text-muted-foreground">
                  {source.version === "created"
                    ? "Provider confirmation"
                    : source.version.length < 18
                      ? `Version ${source.version}`
                      : "Snapshot recorded"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {step.event?.content && (
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
            <FileTextIcon data-icon="inline-start" />
            Read this step’s output
            <ChevronDownIcon data-icon="inline-end" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 text-sm leading-6">
            <MessageResponse>{step.event.content}</MessageResponse>
          </CollapsibleContent>
        </Collapsible>
      )}
      {showInterval && step.elapsedFromPreviousMs !== undefined && (
        <p className="text-xs tabular-nums text-muted-foreground">
          {durationLabel(step.elapsedFromPreviousMs)} since the previous
          checkpoint
        </p>
      )}
    </div>
  );
}

export function shouldScrollWorkflowStep({
  compact,
  inspected,
  previousId,
  selectedId,
  followGuided,
}: {
  compact: boolean;
  inspected: boolean;
  previousId?: string;
  selectedId?: string;
  followGuided: boolean;
}): boolean {
  return !compact && Boolean(selectedId) && (inspected ||
    (followGuided && previousId !== undefined && previousId !== selectedId));
}

export function WorkflowTimeline({
  task,
  compact = false,
  onOpenDetails,
  onRestart,
  restartDisabled = false,
  initialStepId,
  followLatest = false,
}: {
  task: AssistantTask;
  compact?: boolean;
  onOpenDetails?: (stepId?: string) => void;
  onRestart?: (stepId: string) => void;
  restartDisabled?: boolean;
  initialStepId?: string;
  followLatest?: boolean;
}) {
  const flow = projectTaskFlow(task);
  const Heading = compact ? "h2" : "h3";
  // Undefined follows new checkpoints; a chosen ID stays put during polling.
  const [inspectedId, setInspectedId] = useState<string | null | undefined>(
    () => followLatest ? undefined : (initialStepId ?? flow.steps[0]?.id),
  );
  const inspectedStepRef = useRef<HTMLLIElement>(null);
  const hasInspected = useRef(false);
  const inspectStep = (id: string | null | undefined) => {
    hasInspected.current = true;
    setInspectedId(id);
  };
  const selected =
    inspectedId === null
      ? undefined
      : (flow.steps.find((step) => step.id === inspectedId) ??
        flow.steps.at(-1));
  const selectedIndex = selected ? flow.steps.indexOf(selected) : -1;
  const previousSelectedId = useRef(selected?.id);
  const followGuided = task.mode === "rehearsal" && Boolean(task.demo)
    && followLatest && inspectedId === undefined;

  useEffect(() => {
    const shouldScroll = shouldScrollWorkflowStep({
      compact,
      inspected: hasInspected.current,
      previousId: previousSelectedId.current,
      selectedId: selected?.id,
      followGuided,
    });
    previousSelectedId.current = selected?.id;
    if (shouldScroll)
      inspectedStepRef.current?.scrollIntoView({ block: "nearest" });
  }, [compact, followGuided, selected?.id]);

  return (
    <section
      aria-label={compact ? "Live workflow preview" : "Workflow timeline"}
      className={cn("flex min-w-0 flex-col", compact && "border bg-card")}
    >
      <div
        className={cn("flex flex-col gap-3", compact ? "p-4" : "pb-4")}
      >
        <div className="flex items-center justify-between gap-3">
          <Heading className="text-sm font-semibold">
            {compact ? "Live workflow" : "Workflow timeline"}
          </Heading>
          {!compact && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {flow.steps.length} {flow.steps.length === 1 ? "step" : "steps"}
            </span>
          )}
        </div>
        {compact && (
          <p className="line-clamp-2 text-sm font-medium">{task.title}</p>
        )}
        {compact && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge
              variant={task.status === "failed" ? "destructive" : "secondary"}
            >
              {flow.summary}
            </Badge>
          </div>
        )}
        {compact && flow.steps.length > 0 && (
          <StageStrip map={projectStageMap(task, flow)} />
        )}
        {!compact && flow.elapsedMs !== undefined && (
          <span
            className="text-xs tabular-nums text-muted-foreground"
            title="Elapsed run time, including waits. Finished runs stop at their last update."
          >
            {durationLabel(flow.elapsedMs)} elapsed
          </span>
        )}
      </div>

      {!compact && flow.steps.length > 0 && (
        <nav
          aria-label="Inspect recorded steps"
          className="sticky top-0 z-10 mb-3 flex flex-wrap items-center justify-between gap-2 border-y bg-background py-2"
        >
          <span className="text-xs tabular-nums text-muted-foreground">
            {selected
              ? `Step ${selectedIndex + 1} of ${flow.steps.length}`
              : "Choose a step"}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={inspectedId === undefined}
              onClick={() => inspectStep(undefined)}
            >
              Follow latest
            </Button>
            <Button
              size="icon-sm"
              className="size-11 sm:size-8"
              variant="outline"
              aria-label="Previous recorded step"
              disabled={selectedIndex <= 0}
              focusableWhenDisabled
              onClick={() => inspectStep(flow.steps[selectedIndex - 1]?.id)}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              size="icon-sm"
              className="size-11 sm:size-8"
              variant="outline"
              aria-label="Next recorded step"
              disabled={selectedIndex === flow.steps.length - 1}
              focusableWhenDisabled
              onClick={() => inspectStep(flow.steps[selectedIndex + 1]?.id)}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        </nav>
      )}

      {compact ? null : flow.steps.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No recorded steps yet</EmptyTitle>
            <EmptyDescription>
              The first checkpoint will appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol
          className="flex flex-col"
          aria-label="Recorded workflow steps"
        >
          {flow.steps.map((step, index) => {
            const number = index + 1;
            const Icon = stepIcons[step.kind];
            const isCurrent = step.id === flow.currentStepId;
            const expanded = step.id === selected?.id;
            return (
              <li
                key={step.id}
                ref={expanded ? inspectedStepRef : undefined}
                className="relative min-w-0 scroll-mt-16 pb-4 last:pb-0"
              >
                {index < flow.steps.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-4 top-8 w-px bg-border"
                  />
                )}
                <Collapsible
                  open={expanded}
                  onOpenChange={(value) => inspectStep(value ? step.id : null)}
                >
                  <CollapsibleTrigger
                    aria-label={`Step ${number}: ${step.label}`}
                    aria-current={isCurrent ? "step" : undefined}
                    className={cn(
                      "group flex min-h-11 w-full min-w-0 items-start gap-3 rounded-sm text-left outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring",
                      expanded && "bg-muted/70",
                    )}
                  >
                    <span
                      className={cn(
                        "relative flex size-8 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-medium tabular-nums",
                        isCurrent &&
                          "border-primary bg-primary text-primary-foreground",
                        step.state === "failed" &&
                          "border-destructive bg-background text-destructive",
                      )}
                      aria-hidden="true"
                    >
                      {String(number).padStart(2, "0")}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1 py-1 pr-2">
                      <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                        <span className="min-w-0 break-words text-sm font-medium">
                          {step.label}
                        </span>
                        {step.occurredAt && (
                          <time
                            dateTime={step.occurredAt}
                            className="shrink-0 text-xs tabular-nums text-muted-foreground"
                          >
                            {new Date(step.occurredAt).toLocaleTimeString(
                              undefined,
                              {
                                hour: "numeric",
                                minute: "2-digit",
                                second: "2-digit",
                              },
                            )}
                          </time>
                        )}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <Icon className="size-3" aria-hidden="true" />
                        <span>{step.stageLabel}</span>
                        {stateLabels[step.state] && (
                          <span
                            className={cn(
                              "font-medium",
                              step.state === "failed"
                                ? "text-destructive"
                                : "text-foreground",
                            )}
                          >
                            {stateLabels[step.state]}
                          </span>
                        )}
                        <ChevronDownIcon
                          className={cn(
                            "ml-auto size-3 transition-transform motion-reduce:transition-none",
                            expanded && "rotate-180",
                          )}
                          aria-hidden="true"
                        />
                      </span>
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pb-2 pl-11 pt-3">
                    <StepDetails step={step} showInterval={number > 1} />
                    {onRestart && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        disabled={restartDisabled}
                        aria-label={`Restart here: ${step.label}`}
                        onClick={() => onRestart(step.id)}
                      >
                        <RotateCcwIcon data-icon="inline-start" />
                        Restart here
                      </Button>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </li>
            );
          })}
        </ol>
      )}
      {compact && onOpenDetails && (
        <div className="px-4 pb-4">
          <Button variant="outline" className="w-full" onClick={() => onOpenDetails()}>
            View full flow
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      )}
    </section>
  );
}
