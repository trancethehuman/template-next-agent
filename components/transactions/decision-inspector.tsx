"use client";

import { useEffect, useState } from "react";
import { Controls, Position } from "@xyflow/react";
import type { Node as FlowNode, NodeProps } from "@xyflow/react";
import {
  PauseIcon,
  PlayIcon,
  SkipForwardIcon,
  RotateCcwIcon,
} from "lucide-react";
import { Canvas } from "@/components/ai-elements/canvas";
import { Edge } from "@/components/ai-elements/edge";
import {
  Node,
  NodeContent,
  NodeDescription,
  NodeHeader,
  NodeTitle,
} from "@/components/ai-elements/node";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  decisionQuestions,
  evaluationState,
} from "@/lib/classification/questions";
import { getDecisionModel } from "@/lib/classification/models";
import type {
  ClassificationRow,
  DecisionTrace,
} from "@/lib/transactions/types";
import { isTerminalStatus } from "./run-progress";
import { rowStatusLabel } from "./row-steps";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  stageForStatus,
  stepExplanation,
  stepMetadata,
} from "./step-presentation";
import type { Stage } from "./step-presentation";

export type PresentationMode = "step" | "live";
type DiagramNode = FlowNode<{
  title: string;
  description: string;
  state: string;
  selected: boolean;
  stage: Stage;
  metadata: [string, string][];
  rulePath: boolean;
}>;

function DecisionNode({ data }: NodeProps<DiagramNode>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<div tabIndex={0} />}
        aria-label={`${data.title} · ${data.state}`}
        delay={200}
      >
        <Node
          className={cn(
            "w-56 rounded-none",
            data.selected && "ring-2 ring-ring",
            data.state === "Waiting" && "opacity-50",
          )}
          handles={{
            target: data.stage !== "input",
            source: data.stage !== "outcome",
            targetPosition:
              data.stage === "answers" ||
              (data.stage === "outcome" && data.rulePath)
                ? Position.Top
                : data.stage === "policy" || data.stage === "outcome"
                  ? Position.Right
                  : Position.Left,
            sourcePosition:
              data.stage === "model" ||
              (data.stage === "rules" && data.rulePath)
                ? Position.Bottom
                : data.stage === "answers" || data.stage === "policy"
                  ? Position.Left
                  : Position.Right,
          }}
        >
          <NodeHeader className="rounded-none">
            <NodeTitle className="text-sm">{data.title}</NodeTitle>
            <NodeDescription className="text-xs">{data.state}</NodeDescription>
          </NodeHeader>
          <NodeContent className="min-h-16 text-xs leading-relaxed">
            {data.description}
          </NodeContent>
        </Node>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="block w-80 rounded-none p-4 leading-relaxed"
      >
        <p className="mb-3 font-medium">
          {data.title} · {data.state}
        </p>
        <dl className="flex flex-col gap-2">
          {data.metadata.map(([label, value]) => (
            <div key={label}>
              <dt className="text-background/65">{label}</dt>
              <dd className="break-words tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-background/65">Click to see all details.</p>
      </TooltipContent>
    </Tooltip>
  );
}
const nodeTypes = { decision: DecisionNode };
const edgeTypes = { active: Edge.Animated, waiting: Edge.Temporary };
const stages: { id: Stage; title: string; x: number; y: number }[] = [
  { id: "input", title: "1. Read the row", x: 0, y: 0 },
  { id: "rules", title: "2. Check simple rules", x: 250, y: 0 },
  { id: "model", title: "3. Ask the model", x: 500, y: 0 },
  { id: "answers", title: "4. See the answers", x: 500, y: 200 },
  { id: "policy", title: "5. Check the result", x: 250, y: 200 },
  { id: "outcome", title: "6. Show the outcome", x: 0, y: 200 },
];

export function probabilityLabel(value: number | undefined | null): string {
  if (typeof value !== "number") return "Not returned";
  if (value > 0 && value < 0.0005) return "<0.05%";
  if (value < 1 && value > 0.9995) return ">99.95%";
  return `${(value * 100).toFixed(1)}%`;
}

function Distribution({
  values,
  chosen,
}: {
  values?: Record<string, number>;
  chosen?: string;
}) {
  if (!values || Object.keys(values).length === 0)
    return (
      <p className="text-xs text-muted-foreground">
        No probability distribution returned. Missing values are not treated as
        certainty.
      </p>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Option</TableHead>
          <TableHead>Returned probability</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Object.entries(values)
          .sort((a, b) => b[1] - a[1])
          .map(([option, value]) => (
            <TableRow key={option}>
              <TableCell className="font-mono text-xs">
                {option}
                {option === chosen && (
                  <span className="ml-2 text-primary">← chosen</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Progress
                    aria-label={`Probability of ${option}`}
                    className="w-24"
                    value={value * 100}
                  />
                  <span className="font-mono text-xs tabular-nums">
                    {probabilityLabel(value)}
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
}

const answerNames = [
  { id: "movement", label: "Movement" },
  { id: "category", label: "Category" },
  { id: "evidence", label: "Evidence score" },
  { id: "ownAccount", label: "Own-account probability" },
] as const;
type AnswerName = (typeof answerNames)[number]["id"];

function AnswerDetails({ trace }: { trace: DecisionTrace }) {
  const [name, setName] = useState<AnswerName>("movement");
  const answer = trace.answers[name];
  const question = decisionQuestions[name];
  return (
    <div className="flex flex-col gap-6">
      <Field>
        <FieldLabel htmlFor="answer-question">Question</FieldLabel>
        <Select
          value={name}
          onValueChange={(value) => {
            if (value) setName(value as AnswerName);
          }}
          items={answerNames.map((item) => ({
            value: item.id,
            label: item.label,
          }))}
        >
          <SelectTrigger id="answer-question" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {answerNames.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <section aria-label={`${name} answer`} className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-2xl font-medium tabular-nums">
            {answer.type === "choice"
              ? answer.choice
              : answer.type === "score"
                ? `${answer.score.toFixed(3)} / 2`
                : `${probabilityLabel(answer.probability)} true`}
          </p>
          <Badge variant="outline">
            {answer.type === "boolean" ? "P(true)" : answer.type}
          </Badge>
        </div>
        {answer.type === "boolean" ? (
          <p className="text-sm text-muted-foreground">
            Near zero means probably false. No yes/no threshold is applied here.
          </p>
        ) : (
          <Distribution
            values={answer.probabilities}
            chosen={answer.type === "choice" ? answer.choice : undefined}
          />
        )}
        {trace.nativeConfidence?.[name] !== undefined && (
          <p className="text-xs text-muted-foreground">
            Provider confidence:{" "}
            {probabilityLabel(trace.nativeConfidence[name])}. Separate from the
            chosen option’s probability.
          </p>
        )}
        {answer.type === "score" && (
          <p className="text-sm text-muted-foreground">
            An expected position on the 0–2 rubric. This teaching score does not
            determine acceptance.
          </p>
        )}
        <details className="border-t pt-4 text-sm">
          <summary className="cursor-pointer">
            Question and allowed answers
          </summary>
          <p className="my-4 text-muted-foreground">{question.instructions}</p>
          {"criteria" in question && (
            <ul className="flex flex-col gap-3 text-xs text-muted-foreground">
              {Object.entries(question.criteria).map(([key, criterion]) => (
                <li key={key}>
                  <code>{key}</code>: {criterion}
                </li>
              ))}
            </ul>
          )}
        </details>
      </section>
      <p className="text-xs text-muted-foreground">
        The four questions share one input and one call. Each is evaluated
        independently.
      </p>
    </div>
  );
}

export function DecisionInspector({
  row,
  history,
  mode,
  finished,
  started,
  focused,
}: {
  row: ClassificationRow;
  history: readonly ClassificationRow[];
  mode: PresentationMode;
  finished: boolean;
  started: boolean;
  focused: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [cursor, setCursor] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [selectedStage, setSelectedStage] = useState<Stage | null>(null);
  const length = Math.max(1, history.length);
  const count = mode === "live" ? length : Math.min(cursor, length);
  const visible = history.slice(0, count);
  const current = visible.at(-1) ?? {
    ...row,
    status: "queued" as const,
    trace: undefined,
  };
  const trace = current.trace;
  const model = getDecisionModel(row.modelId ?? "typesafe-ai/jev");
  const terminal = isTerminalStatus(current.status);
  const ruleMatch = terminal && current.source === "rule";
  const saw = (status: ClassificationRow["status"]) =>
    visible.some((step) => step.status === status);
  const modelSeen = saw("jev");
  const activeStage = stageForStatus(current.status);
  const inspectedStage = selectedStage ?? activeStage;

  useEffect(() => {
    if (!playing || mode === "live" || cursor >= length) return;
    const timer = setTimeout(() => {
      const next = Math.min(cursor + 1, length);
      setCursor(next);
      setSelectedStage(null);
    }, 1200);
    return () => clearTimeout(timer);
  }, [playing, cursor, length, mode, history]);

  function reveal(next: number) {
    setCursor(next);
    setSelectedStage(null);
  }

  function stageState(id: Stage): string {
    if (id === "input") return "Ready";
    if (id === "rules")
      return saw("rules")
        ? row.rulesApplied === false
          ? "Turned off"
          : ruleMatch
            ? "Matched"
            : modelSeen
              ? "No rule matched"
              : "Checking"
        : "Waiting";
    if (id === "model")
      return ruleMatch
        ? "Skipped · rule matched"
        : modelSeen
          ? trace
            ? "Returned"
            : terminal
              ? "Failed"
              : "Evaluating"
          : "Waiting";
    if (id === "answers")
      return ruleMatch
        ? "Skipped"
        : trace
          ? "Returned"
          : current.status === "failed"
            ? "Unavailable"
            : "Waiting";
    if (id === "policy")
      return ruleMatch
        ? "Skipped · rule outcome"
        : saw("policy")
          ? "Checked"
          : "Waiting";
    return terminal ? rowStatusLabel(current.status) : "Waiting";
  }
  function description(id: Stage): string {
    switch (id) {
      case "input":
        return `${row.currency} ${(row.amountMinor / 100).toFixed(2)} · ${row.amountMinor < 0 ? "paid out" : "received in"}`;
      case "rules":
        return row.rulesApplied === false
          ? "Rules are off for this run."
          : "Can a simple rule handle this?";
      case "model":
        return `${model.provider} / ${model.label}${trace ? ` · ${trace.elapsedMs.toLocaleString()} ms` : ""}`;
      case "answers":
        return trace
          ? `Movement: ${trace.answers.movement.choice} · Category: ${trace.answers.category.choice}`
          : "Two choices, a score and a probability.";
      case "policy":
        return "Do the answers pass our checks?";
      case "outcome":
        return terminal
          ? current.status === "failed"
            ? "Rerun after checking model access."
            : current.status === "needs_review"
              ? "Needs a person to review it."
              : (current.category ?? current.movement ?? "Human review")
          : "A category or a request for review.";
    }
  }
  const nodes: DiagramNode[] = stages.map((stage) => ({
    id: stage.id,
    type: "decision",
    position: { x: stage.x, y: stage.y },
    data: {
      title: stage.title,
      description: description(stage.id),
      state: stageState(stage.id),
      selected: activeStage === stage.id,
      stage: stage.id,
      metadata: stepMetadata(stage.id, current),
      rulePath: ruleMatch,
    },
  }));
  const links: [Stage, Stage][] = ruleMatch
    ? [
        ["input", "rules"],
        ["rules", "outcome"],
      ]
    : [
        ["input", "rules"],
        ["rules", "model"],
        ["model", "answers"],
        ["answers", "policy"],
        ["policy", "outcome"],
      ];
  const edges = links.map(([source, target]) => ({
    id: `${source}-${target}`,
    source,
    target,
    type:
      stageState(target) === "Waiting"
        ? "waiting"
        : target === "model" &&
            current.status === "jev" &&
            !finished &&
            mode === "live"
          ? "active"
          : ruleMatch
            ? "smoothstep"
            : "default",
  }));

  const mobileStage = activeStage;

  return (
    <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
      <section
        aria-label="Transaction decision inspector"
        className="flex min-w-0 flex-col gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-y py-4">
          <p className="text-sm text-muted-foreground" role="status">
            {model.label} ·{" "}
            {mode === "step"
              ? !started
                ? "Ready"
                : finished
                  ? `Run finished · recorded step ${count} of ${length}`
                  : `Recorded step ${count} · batch running`
              : !started
                ? "Ready"
                : finished
                  ? "Run finished"
                  : "Processing"}
          </p>
          {mode === "step" && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Restart playback"
                disabled={!started}
                onClick={() => {
                  reveal(1);
                  setPlaying(false);
                }}
              >
                <RotateCcwIcon />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!started || (count >= length && finished)}
                onClick={() => setPlaying((value) => !value)}
              >
                {playing && !(finished && count >= length) ? (
                  <PauseIcon data-icon="inline-start" />
                ) : (
                  <PlayIcon data-icon="inline-start" />
                )}
                {finished && count >= length
                  ? "Playback complete"
                  : playing
                    ? "Pause"
                    : "Play steps"}
              </Button>
              <Button
                size="sm"
                disabled={count >= length}
                onClick={() => {
                  setPlaying(false);
                  reveal(count + 1);
                }}
              >
                Next step <SkipForwardIcon data-icon="inline-end" />
              </Button>
            </div>
          )}
        </div>
        <div
          className="flex flex-col gap-2 py-2"
          aria-live="polite"
          aria-label="Step explanation"
        >
          <h2 className="text-xl font-medium tracking-tight">
            {stages.find((stage) => stage.id === activeStage)!.title}
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {stepExplanation(activeStage, current)}
          </p>
        </div>
        <div
          className="hidden h-96 w-full border sm:block"
          aria-label="Decision workflow graph"
        >
          <Canvas
            key={focused ? "focused" : "split"}
            showBackground={false}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            deleteKeyCode={null}
            selectionOnDrag={false}
            minZoom={0.3}
            maxZoom={1.5}
            fitViewOptions={{ padding: 0.08 }}
            onNodeClick={(_, node) => {
              setSelectedStage(node.id as Stage);
              setDetailsOpen(true);
            }}
          >
            <Controls showInteractive={false} />
          </Canvas>
        </div>
        <div className="sm:hidden" aria-label="Current workflow step">
          <Node
            handles={{ target: false, source: false }}
            className="w-full rounded-none"
          >
            <NodeHeader className="rounded-none">
              <NodeTitle>
                {stages.find((stage) => stage.id === mobileStage)!.title}
              </NodeTitle>
              <NodeDescription>{stageState(mobileStage)}</NodeDescription>
            </NodeHeader>
            <NodeContent>{description(mobileStage)}</NodeContent>
          </Node>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Field className="w-full sm:w-64">
            <FieldLabel htmlFor="inspect-stage">Inspect step</FieldLabel>
            <Select
              value={inspectedStage}
              onValueChange={(value) => {
                if (value) {
                  setSelectedStage(value as Stage);
                  setDetailsOpen(true);
                }
              }}
              items={stages.map((stage) => ({
                value: stage.id,
                label: stage.title,
              }))}
            >
              <SelectTrigger id="inspect-stage" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {stages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <SheetTrigger render={<Button variant="outline" />}>
            View step details
          </SheetTrigger>
        </div>
        <SheetContent size="wide">
          <SheetHeader className="border-b pr-12">
            <SheetTitle>
              {stages.find((stage) => stage.id === inspectedStage)!.title}
            </SheetTitle>
            <SheetDescription>{stageState(inspectedStage)}</SheetDescription>
          </SheetHeader>
          <div
            className="min-h-0 flex-1 overflow-y-auto px-6 pb-6"
            aria-live="polite"
          >
            {inspectedStage === "input" && (
              <>
                <h3 className="mb-3 font-medium">
                  Structured evaluation state
                </h3>
                <p className="mb-3 text-xs text-muted-foreground">
                  Parsed and validated in code; sent when model evaluation runs.
                  The description is untrusted data, never an instruction.
                </p>
                <pre className="overflow-x-auto bg-muted p-4 text-xs leading-relaxed">
                  {JSON.stringify(evaluationState(row), null, 2)}
                </pre>
              </>
            )}
            {inspectedStage === "rules" && (
              <>
                <h3 className="mb-3 font-medium">Deterministic rule check</h3>
                <p className="text-sm text-muted-foreground">
                  {row.rulesApplied === false
                    ? "Rules were bypassed for this run so the model sees the row."
                    : ruleMatch
                      ? current.reason
                      : modelSeen
                        ? "No strict rule matched. The workflow called the selected model."
                        : "Only explicit own-account transfers and provider fees qualify. Ordinary merchants need model judgment."}
                </p>
              </>
            )}
            {inspectedStage === "model" && (
              <>
                <h3 className="mb-3 font-medium">
                  One native evaluation request
                </h3>
                <p className="text-sm text-muted-foreground">
                  {model.id} · {stageState("model")}. All four questions are
                  independent; the graph does not expose hidden reasoning.
                </p>
                {model.id === "openai/gpt-6-luna-decisions" && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    GPT-6 Luna uses OpenAI’s native Decisions API via AI
                    Gateway. The same choices, score rubric, and boolean
                    question are used for Jev. The SDK maps OpenAI’s predicate
                    answer to P(true).
                  </p>
                )}
                {trace && (
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Request elapsed, including Gateway
                      </dt>
                      <dd className="font-mono">
                        {trace.elapsedMs.toLocaleString()} ms
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Returned token usage
                      </dt>
                      <dd className="font-mono">
                        {trace.usage.inputTokens ?? "—"} input /{" "}
                        {trace.usage.outputTokens ?? "—"} output
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">
                        Response model / question version
                      </dt>
                      <dd className="break-words font-mono">
                        {trace.responseModelId} / {trace.version}
                      </dd>
                    </div>
                  </dl>
                )}
              </>
            )}
            {inspectedStage === "answers" &&
              (trace ? (
                <AnswerDetails trace={trace} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {ruleMatch
                    ? "No model was called for this rule match."
                    : current.status === "failed"
                      ? "The call failed. No answers were fabricated."
                      : "Advance to the returned-answer event to inspect choices, distributions, score, and P(true)."}
                </p>
              ))}
            {inspectedStage === "policy" && (
              <>
                <h3 className="mb-3 font-medium">
                  Application policy, expressed in code
                </h3>
                <ul className="flex list-inside list-disc flex-col gap-2 text-sm text-muted-foreground">
                  <li>Movement selected probability ≥ 85%; category ≥ 90%.</li>
                  <li>
                    Each selected option must lead the runner-up by ≥ 20
                    percentage points.
                  </li>
                  <li>
                    Direction and category must agree with the transaction.
                  </li>
                  <li>
                    Transfers do not require a category. Missing probabilities
                    require review.
                  </li>
                  <li>
                    The evidence score and P(true) are independent teaching
                    outputs.
                  </li>
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  These are demo thresholds, not calibrated guarantees across
                  models.
                </p>
              </>
            )}
            {inspectedStage === "outcome" && (
              <>
                <h3 className="mb-3 font-medium">
                  {terminal
                    ? rowStatusLabel(current.status)
                    : "Outcome pending"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {terminal
                    ? current.reason
                    : "Advance through the recorded events to see the final application action."}
                </p>
                {terminal && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {current.source === "rule"
                      ? "Resolved by code; no model call."
                      : `Minimum selected-option probability: ${probabilityLabel(current.confidence)}.`}{" "}
                    Row processing:{" "}
                    {current.rowElapsedMs?.toLocaleString() ?? "—"} ms. No
                    accounting entry is posted.
                  </p>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </section>
    </Sheet>
  );
}
