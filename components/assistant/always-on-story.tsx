"use client";

import { useEffect, useEffectEvent, useState } from "react";
import {
  ArrowDownToLineIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  EyeOffIcon,
  MailIcon,
  PauseIcon,
  PencilLineIcon,
  PlayIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { FlowDiagram } from "@/components/assistant/stage-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  storyApprovedBefore,
  storyCopy,
  storyIndex,
  storyMissed,
  storyNext,
  storyPasses,
  storySeek,
  storyStageMap,
  storyScenarios,
  storyStageStep,
  storySteps,
  type StoryCheck,
  type StoryDecision,
  type StoryInsight,
  type StoryMessage,
  type StoryScenario,
  type StoryStage,
} from "@/lib/assistant/always-on-story";
import {
  runShortcut,
  shortcutTargetAllowed,
} from "@/lib/assistant/run-transport";
import type { StageView } from "@/lib/assistant/stage-map";
import { cn } from "@/lib/utils";

const stepDelayMs = 2000;

const insightStatus: Partial<Record<StoryInsight["status"], string>> = {
  still_open: "Still open",
  resolved: "Resolved",
};

const checkChange: Record<NonNullable<StoryCheck["change"]>, string> = {
  new: "New",
  moved: "Moved",
  removed: "Removed",
};

const differences: [string, string, string][] = [
  ["Starts", "When you ask", "When you ask, on its own schedule, or when an email arrives"],
  ["Looks at", "What you asked about", "Also what you didn’t ask: clashes, missing people, open threads"],
  ["Follows up", "Never", "Chases replies and deadlines until they close"],
  ["Remembers", "Nothing between asks", "What it read, sent, and is waiting on"],
  ["Stops", "After one answer", "When the goal is done, or when you stop it"],
];

function InsightList({ insights }: { insights: StoryInsight[] }) {
  const groups = [
    { label: "Blind spots", items: insights.filter((item) => item.kind === "blind_spot") },
    { label: "Open loops", items: insights.filter((item) => item.kind === "open_loop") },
  ].filter((group) => group.items.length > 0);
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label} className="flex flex-col gap-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">{group.label}</h4>
          <ul className="flex flex-col gap-1.5">
            {group.items.map((item) => (
              <li key={item.title} className="flex items-start gap-2 text-sm leading-6">
                {item.status === "resolved" ? (
                  <CheckIcon className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-foreground" aria-hidden="true" />
                )}
                <span className={cn(item.status === "resolved" && "text-muted-foreground line-through")}>
                  {item.title}
                </span>
                {insightStatus[item.status] && (
                  <span className="ml-auto shrink-0 text-xs leading-6 text-muted-foreground">
                    {insightStatus[item.status]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ScheduleList({ checks }: { checks: StoryCheck[] }) {
  const next = checks.find((check) => check.change !== "removed");
  return (
    <section aria-label="Its own schedule" className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium text-muted-foreground">Checks it scheduled for itself</h4>
      <ol className="flex flex-col gap-1">
        {checks.map((check) => (
          <li
            key={`${check.at}:${check.reason}`}
            className={cn(
              "flex items-start gap-3 rounded-md px-2 py-1.5 text-sm",
              check === next && "bg-muted",
            )}
          >
            <ClockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="flex min-w-0 flex-1 flex-col">
              <p
                className={cn(
                  "flex flex-wrap items-baseline gap-x-2 font-medium tabular-nums",
                  check.change === "removed" && "text-muted-foreground line-through",
                )}
              >
                {check.at}
                <code className="font-mono text-xs font-normal text-muted-foreground">{check.cron}</code>
              </p>
              <p className="text-muted-foreground">{check.reason}</p>
            </div>
            {check.change && (
              <span className="shrink-0 text-xs text-muted-foreground">{checkChange[check.change]}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function MessageCard({ message, kind }: { message: StoryMessage; kind: "email" | "draft" }) {
  const Icon = kind === "email" ? MailIcon : PencilLineIcon;
  return (
    <section
      aria-label={kind === "email" ? `Email from ${message.person}` : `Draft to ${message.person}`}
      className={cn(
        "flex flex-col gap-1 rounded-lg border px-4 py-3 text-sm",
        kind === "draft" && "border-dashed",
      )}
    >
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {kind === "email" ? `From ${message.person}` : `Draft to ${message.person} · not sent`}
      </p>
      <p className="leading-6">{message.body}</p>
    </section>
  );
}

/**
 * A mocked week with an always-on agent: its own schedule, blind spots, and
 * follow-ups. It runs entirely in the browser on fictional data.
 */
export function AlwaysOnStory({ active }: { active: boolean }) {
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, StoryDecision>>({});
  const [playing, setPlaying] = useState(false);
  // Play to a stage stops once this step is reached.
  const [playTo, setPlayTo] = useState<number>();
  const [scenarioId, setScenarioId] = useState<string>();
  const [compareOpen, setCompareOpen] = useState(false);

  const step = storySteps[index];
  const pass = storyPasses[step.pass];
  const copy = storyCopy(step, decisions);
  const next = storyNext(index, decisions);
  const waiting = Boolean(step.decision && !decisions[step.id]);
  const ended = index === storySteps.length - 1;
  const map = storyStageMap(index, decisions, playing && next !== undefined);
  // A decision shows the draft it's about.
  const draft =
    step.draft ??
    (step.decision
      ? storySteps.find((item) => item.pass === step.pass && item.draft)?.draft
      : undefined);
  const scenario = storyScenarios.find(
    (item) =>
      item.id === scenarioId &&
      index >= storyIndex(item.start) &&
      index <= storyIndex(item.end),
  );

  // Playback moves one step at a time and waits at each decision.
  useEffect(() => {
    if (!playing || next === undefined) return;
    const timer = window.setTimeout(() => {
      setIndex(next);
      if ((playTo !== undefined && next >= playTo) || next === storySteps.length - 1) {
        setPlaying(false);
        setPlayTo(undefined);
      }
    }, stepDelayMs);
    return () => window.clearTimeout(timer);
  }, [playing, next, playTo]);

  const pause = () => {
    setPlaying(false);
    setPlayTo(undefined);
  };
  const seek = (target: number) => {
    pause();
    setIndex(storySeek(target, decisions));
  };
  const restartFrom = (target: number) => {
    pause();
    setDecisions((value) =>
      Object.fromEntries(
        Object.entries(value).filter(
          ([id]) => storySteps.findIndex((item) => item.id === id) < target,
        ),
      ),
    );
    setIndex(target);
  };
  // Stepping keeps a chosen scenario's end, so Play still stops there.
  const goNext = () => {
    if (next === undefined) return;
    setPlaying(false);
    setIndex(next);
  };
  const goBack = () => {
    setPlaying(false);
    setIndex(Math.max(0, index - 1));
  };
  const toggle = () => {
    if (ended) {
      restartFrom(0);
      setPlaying(true);
      return;
    }
    // Play stops at the end of the chosen scenario, unless it is already there.
    if (playTo !== undefined && index >= playTo) setPlayTo(undefined);
    setPlaying((value) => !value);
  };
  const decide = (choice: StoryDecision) => {
    setDecisions((value) => ({ ...value, [step.id]: choice }));
    setIndex(index + 1);
  };
  const playToStage = (target: number) => {
    setPlayTo(target);
    setPlaying(true);
  };
  // A scenario starts mid-week with earlier decisions approved. Play then stops at its end.
  const playScenario = (item: StoryScenario) => {
    const start = storyIndex(item.start);
    setDecisions((value) =>
      Object.fromEntries(
        Object.entries(storyApprovedBefore(start, value)).filter(
          ([id]) => storyIndex(id) < start,
        ),
      ),
    );
    setScenarioId(item.id);
    setIndex(start);
    setPlayTo(storyIndex(item.end));
    setPlaying(false);
  };
  // Restart replays the scenario being shown, or the whole week.
  const restart = () => (scenario ? playScenario(scenario) : restartFrom(0));
  const restartDisabled = scenario ? index === storyIndex(scenario.start) : index === 0;

  const selectStage = (stage: StageView) => {
    const target = storyStageStep(index, stage.id as StoryStage);
    if (target !== undefined) return target > index ? playToStage(target) : seek(target);
    const last = storySteps.findIndex((item) => item.id === stage.lastStepId);
    if (last >= 0) seek(last);
  };
  const stageAction = (stage: StageView) => {
    const target = storyStageStep(index, stage.id as StoryStage);
    if (target === undefined || target === index) return undefined;
    const ahead = target > index;
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`${ahead ? "Play to here" : "Start from here"}: ${stage.label}`}
              onClick={() => (ahead ? playToStage(target) : restartFrom(target))}
            />
          }
        >
          {ahead ? <ArrowDownToLineIcon /> : <RotateCcwIcon />}
        </TooltipTrigger>
        <TooltipContent>
          {ahead ? `Play to here · pauses at ${stage.label}` : `Start from here · replays from ${stage.label}`}
        </TooltipContent>
      </Tooltip>
    );
  };

  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    const shortcut = runShortcut(event);
    if (!shortcut || !shortcutTargetAllowed(event.target, event.key)) return;
    event.preventDefault();
    if (shortcut === "toggle") toggle();
    else if (shortcut === "previous-step") goBack();
    else if (shortcut === "next" || shortcut === "next-step") goNext();
  });

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && !event.repeat) handleShortcut(event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  return (
    <section aria-label="Always-on story" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">One request, one week</h2>
            <Badge variant="outline">Mocked story</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Fictional people and email. Nothing is read or sent.
          </p>
        </div>
        <Select
          value={scenario?.id ?? null}
          onValueChange={(value) => {
            const item = storyScenarios.find((candidate) => candidate.id === value);
            if (item) playScenario(item);
          }}
          items={storyScenarios.map((item) => ({ value: item.id, label: item.label }))}
        >
          <SelectTrigger aria-label="Scenario" className="w-full sm:w-64">
            <SelectValue placeholder="Jump to a scenario" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {storyScenarios.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </header>

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-5">
          <FlowDiagram
            map={map}
            request={{ label: pass.label, text: pass.text, time: pass.at }}
            onSelectStage={selectStage}
            stageAction={stageAction}
          />
        </div>
        <article
          aria-label="Story step"
          className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card lg:sticky lg:top-4 lg:col-span-7"
        >
          <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-6">
            <p className="sr-only" aria-live="polite">
              {pass.at}: {copy.title}
            </p>
            <div
              key={step.id}
              className="flex max-w-2xl flex-col gap-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300"
            >
              <h3 className="text-2xl font-semibold tracking-tight">{copy.title}</h3>
              <p className="leading-7 text-muted-foreground">{copy.detail}</p>
            </div>
            {step.sources && (
              <ul aria-label="Sources read" className="flex flex-col gap-1 text-sm text-muted-foreground">
                {step.sources.map((source) => (
                  <li key={source}>{source}</li>
                ))}
              </ul>
            )}
            {step.insights && <InsightList insights={step.insights} />}
            {step.email && <MessageCard message={step.email} kind="email" />}
            {step.brief && (
              <div className="rounded-lg border bg-background p-4 text-sm leading-6" aria-label="Brief">
                <MessageResponse>{step.brief.map((line) => `- ${line}`).join("\n")}</MessageResponse>
              </div>
            )}
            {draft && <MessageCard message={draft} kind="draft" />}
            {step.schedule && <ScheduleList checks={step.schedule} />}
            {step.decision &&
              (waiting ? (
                <section aria-label="Your move" className="flex flex-wrap gap-2">
                  <Button size="lg" onClick={() => decide("approved")}>
                    <ShieldCheckIcon data-icon="inline-start" />
                    {step.decision.approve}
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => decide("declined")}>
                    {step.decision.decline}
                  </Button>
                </section>
              ) : (
                <p className="text-sm text-muted-foreground">
                  You chose: {decisions[step.id] === "approved" ? step.decision.approve : step.decision.decline}
                </p>
              ))}
            {step.lesson && (
              <p className="max-w-2xl rounded-lg bg-muted px-4 py-3 text-sm leading-6">
                <span className="font-semibold">{step.lesson.concept}.</span> {step.lesson.text}
              </p>
            )}
            {step.missed && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <EyeOffIcon className="size-4 shrink-0" aria-hidden="true" />
                A task agent would miss this. It stopped on Monday.
              </p>
            )}
            {ended && (
              <section aria-label="What a task agent missed" className="flex flex-col gap-1.5">
                <h4 className="text-xs font-medium text-muted-foreground">
                  A task agent stopped on Monday, so it missed
                </h4>
                <ul className="flex flex-col gap-1 text-sm">
                  {storyMissed(index).map((item) => (
                    <li key={item} className="flex items-center gap-2">
                      <EyeOffIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <section
            aria-label="Story controls"
            className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-4 py-3 sm:px-6"
          >
            <Button
              size="icon"
              variant="ghost"
              aria-label="Previous step"
              disabled={index === 0}
              onClick={goBack}
            >
              <SkipBackIcon />
            </Button>
            <Button variant={playing ? "default" : "outline"} disabled={waiting && !playing} onClick={toggle}>
              {playing ? <PauseIcon data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
              {playing ? "Pause" : ended ? "Play again" : "Play"}
            </Button>
            <Button disabled={next === undefined} onClick={goNext}>
              <SkipForwardIcon data-icon="inline-start" />
              Next step
            </Button>
            {waiting ? (
              <span className="text-sm text-muted-foreground">Decide above to continue</span>
            ) : (
              <Button variant="ghost" disabled={restartDisabled} onClick={restart}>
                <RotateCcwIcon data-icon="inline-start" />
                Restart
              </Button>
            )}
          </section>
        </article>
      </div>

      <Collapsible open={compareOpen} onOpenChange={setCompareOpen} className="flex flex-col gap-3">
        <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="self-start" />}>
          <ChevronDownIcon
            data-icon="inline-start"
            className={cn("transition-transform motion-reduce:transition-none", compareOpen && "rotate-180")}
          />
          Compare with a task agent
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="overflow-hidden rounded-lg border">
            <Table aria-label="Task agent vs always-on agent">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-28 px-4">
                    <span className="sr-only">Behaviour</span>
                  </TableHead>
                  <TableHead className="px-4 text-xs text-muted-foreground">Task agent</TableHead>
                  <TableHead className="px-4 text-xs text-muted-foreground">Always-on agent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {differences.map(([label, task, always]) => (
                  <TableRow key={label}>
                    <TableCell className="px-4 align-top font-medium whitespace-normal">{label}</TableCell>
                    <TableCell className="px-4 align-top whitespace-normal text-muted-foreground">{task}</TableCell>
                    <TableCell className="px-4 align-top whitespace-normal">{always}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
