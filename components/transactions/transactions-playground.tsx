"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ChangeEvent, DragEvent } from "react";
import {
  ArrowRightIcon,
  ArrowLeftIcon,
  CheckIcon,
  DownloadIcon,
  LoaderCircleIcon,
  PlayIcon,
  RotateCcwIcon,
  UploadIcon,
} from "lucide-react";
import { DecisionInspector, probabilityLabel } from "./decision-inspector";
import { ModelProfile } from "./model-profile";
import {
  applyRunEvent,
  createRunProgress,
  isTerminalStatus,
  summarizeRows,
} from "./run-progress";
import type { RunProgress } from "./run-progress";
import { rowStatusLabel } from "./row-steps";
import { executionStatusLabel } from "./execution-status";
import { RunStreamFatalError, watchRun } from "./run-stream";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import { DecisionModelSelect, TransactionPicker } from "./lab-controls";
import { navigateTransactionView } from "./navigation";
import { getTransactionView, transactionViews } from "@/lib/transactions/views";
import type { TransactionView } from "@/lib/transactions/views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldGroup,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress, ProgressLabel } from "@/components/ui/progress";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDecisionModel } from "@/lib/classification/models";
import type { DecisionModelId } from "@/lib/classification/models";
import { MAX_CSV_BYTES, parseTransactionCsv } from "@/lib/transactions/csv";
import { mockTransactions } from "@/lib/transactions/mock";
import type {
  ClassificationRow,
  TransactionInput,
} from "@/lib/transactions/types";
import { cn } from "@/lib/utils";

type RunState = "starting" | "running" | "completed" | "failed";
interface Experiment {
  key: string;
  runId?: string;
  modelId: DecisionModelId;
  useRules: boolean;
  progress: RunProgress;
  state: RunState;
}

function amount(row: TransactionInput): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: row.currency,
  }).format(row.amountMinor / 100);
}

export function TransactionStatus({ row }: { row: ClassificationRow }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge
        variant={
          row.status === "failed"
            ? "destructive"
            : row.status === "classified"
              ? "default"
              : "outline"
        }
      >
        {rowStatusLabel(row.status)}
      </Badge>
      {row.reason &&
        (row.status === "failed" || row.status === "needs_review") && (
          <span className="text-xs text-muted-foreground">{row.reason}</span>
        )}
    </div>
  );
}

async function responseMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
    ? body.error
    : fallback;
}

export function TransactionsPlayground({
  localDevelopment = false,
}: {
  localDevelopment?: boolean;
}) {
  const searchParams = useSearchParams();
  const view = getTransactionView(searchParams.get("view"));
  const [source, setSource] = useState("upload");
  const [transactions, setTransactions] = useState<TransactionInput[]>([]);
  const [selectedIds, setSelectedIds] = useState(() =>
    mockTransactions.map((row) => row.id),
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [syntheticData, setSyntheticData] = useState(false);
  const [modelId, setModelId] = useState<DecisionModelId>("typesafe-ai/jev");
  const [useRules, setUseRules] = useState(true);
  const [token, setToken] = useState("");
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selectedRowId, setSelectedRowId] = useState(mockTransactions[0].id);
  const [selectedExperiment, setSelectedExperiment] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [reconnects, setReconnects] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const previousView = useRef(view);
  useEffect(() => {
    if (previousView.current !== view)
      headingRef.current?.focus({ preventScroll: true });
    previousView.current = view;
  }, [view]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const latest = experiments.at(-1);
  const busy = latest?.state === "starting" || latest?.state === "running";
  const model = getDecisionModel(modelId);
  const needsSynthetic = !model.zeroDataRetention && !syntheticData;
  const rows = transactions.map(
    (transaction) =>
      [...experiments]
        .reverse()
        .flatMap((run) => run.progress.rows)
        .find((row) => row.id === transaction.id) ??
      createRunProgress([transaction]).rows[0],
  );
  const rowRuns = experiments.filter((run) =>
    run.progress.rows.some((row) => row.id === selectedRowId),
  );
  const inspectedRun =
    rowRuns.find((run) => run.key === selectedExperiment) ?? rowRuns.at(-1);
  const selectedRow =
    inspectedRun?.progress.rows.find((row) => row.id === selectedRowId) ??
    rows.find((row) => row.id === selectedRowId);
  const { completed, total, reviews } = summarizeRows(
    view === "step" || view === "live"
      ? (inspectedRun?.progress.rows ?? rows)
      : rows,
  );

  function replaceData(
    data: TransactionInput[],
    nextSource: string,
    name: string | null,
    synthetic: boolean,
  ) {
    abortRef.current?.abort();
    setTransactions(data);
    setSource(nextSource);
    setFileName(name);
    setSyntheticData(synthetic);
    setExperiments([]);
    setSelectedExperiment(null);
    setSelectedRowId(data[0]?.id ?? "");
    setError(null);
    setReconnects(0);
  }
  function switchSource(value: string) {
    if (value === "sample") {
      setSelectedIds(mockTransactions.map((row) => row.id));
      replaceData(mockTransactions, value, null, true);
    } else replaceData([], value, null, false);
  }
  function toggleSample(id: string, checked: boolean) {
    const nextIds = checked
      ? [...selectedIds, id]
      : selectedIds.filter((candidate) => candidate !== id);
    setSelectedIds(nextIds);
    replaceData(
      mockTransactions.filter((row) => nextIds.includes(row.id)),
      "sample",
      null,
      true,
    );
  }
  async function loadFile(file: File) {
    replaceData([], "upload", null, false);
    if (file.size > MAX_CSV_BYTES) {
      setError("CSV file is too large. Choose a file under 64 KB.");
      return;
    }
    try {
      const parsed = parseTransactionCsv(await file.text());
      replaceData(parsed, "upload", file.name, false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "CSV could not be read.",
      );
    }
  }
  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await loadFile(file);
  }
  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (!busy && event.dataTransfer.files[0])
      void loadFile(event.dataTransfer.files[0]);
  }

  async function startRun(input: TransactionInput[]) {
    if (busy || !input.length || needsSynthetic) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const key = crypto.randomUUID();
    const experiment: Experiment = {
      key,
      modelId,
      useRules,
      progress: createRunProgress(input, { modelId, useRules }),
      state: "starting",
    };
    setExperiments((previous) => [...previous.slice(-19), experiment]);
    setSelectedRowId(
      input.some((row) => row.id === selectedRowId)
        ? selectedRowId
        : input[0].id,
    );
    setSelectedExperiment(key);

    setError(null);
    setReconnects(0);
    const update = (change: (run: Experiment) => Experiment) =>
      setExperiments((previous) =>
        previous.map((run) => (run.key === key ? change(run) : run)),
      );
    const authorization = token.trim();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (authorization) headers.Authorization = `Bearer ${authorization}`;
    try {
      const created = await fetch("/api/runs", {
        method: "POST",
        headers,
        body: JSON.stringify({
          transactions: input,
          options: { modelId, useRules, syntheticData },
        }),
        signal: controller.signal,
      });
      if (!created.ok)
        throw new Error(
          await responseMessage(created, "Could not start this run."),
        );
      const body: unknown = await created.json();
      if (
        !body ||
        typeof body !== "object" ||
        !("runId" in body) ||
        typeof body.runId !== "string"
      )
        throw new Error("The run did not return an ID.");
      const runId = body.runId;
      update((run) => ({ ...run, runId, state: "running" }));
      await watchRun(
        async (startIndex) => {
          const stream = await fetch(
            `/api/runs/${encodeURIComponent(runId)}/stream?startIndex=${startIndex}`,
            {
              headers: authorization
                ? { Authorization: `Bearer ${authorization}` }
                : undefined,
              cache: "no-store",
              signal: controller.signal,
            },
          );
          if (!stream.ok) {
            const message = await responseMessage(
              stream,
              "Could not connect to the live run.",
            );
            if (stream.status < 500) throw new RunStreamFatalError(message);
            throw new Error(message);
          }
          if (!stream.body)
            throw new Error("The live run did not return a status stream.");
          setReconnects(0);
          return stream.body;
        },
        (event) => {
          if (event.type === "done") {
            update((run) => ({ ...run, state: event.status }));
            if (event.status === "failed")
              setError(
                "Some model calls failed. Inspect the affected row, check model access, and rerun it.",
              );
          } else
            update((run) => ({
              ...run,
              progress: applyRunEvent(run.progress, event),
            }));
        },
        controller.signal,
        setReconnects,
      );
    } catch (cause) {
      if (controller.signal.aborted) return;

      update((run) => ({ ...run, state: "failed" }));
      setError(cause instanceof Error ? cause.message : "The run failed.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function selectRow(id: string) {
    setSelectedRowId(id);
    setSelectedExperiment(null);
  }

  function openRow(id: string, destination: TransactionView = "step") {
    selectRow(id);
    navigateTransactionView(destination);
  }

  const subtitles: Record<TransactionView, string> = {
    models: "Pick who will answer the questions.",
    import: "Start with a fictional CSV or a few example transactions.",
    transactions: `${transactions.length} transactions · latest result for each row`,
    step: "Start the batch, then walk through one transaction at your own pace.",
    live: "Watch actual model calls finish at full speed.",
    compare: "Rerun the same transaction with another model.",
    settings: "Adjust the rules and access settings.",
  };
  const runDisabled = busy || !transactions.length || needsSynthetic;

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-3xl font-medium tracking-tight outline-none"
          >
            {transactionViews.find((item) => item.id === view)!.title}
          </h1>
          <p className="text-sm text-muted-foreground">{subtitles[view]}</p>
        </div>
      </header>

      {view === "models" && (
        <section
          aria-label="Choose a model"
          className="flex max-w-xl flex-col gap-6"
        >
          <DecisionModelSelect
            value={modelId}
            onChange={setModelId}
            disabled={busy}
            label="Model"
          />
          <ModelProfile
            modelId={modelId}
            lastElapsedMs={
              experiments
                .flatMap((run) => run.progress.rows)
                .filter((row) => row.trace?.modelId === modelId)
                .sort(
                  (a, b) =>
                    (a.trace?.finishedAt ?? 0) - (b.trace?.finishedAt ?? 0),
                )
                .at(-1)?.trace?.elapsedMs
            }
          />
          <Button
            className="self-end"
            onClick={() => navigateTransactionView("import")}
          >
            Next: add transactions <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </section>
      )}

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 text-sm text-destructive"
        >
          <p>{error}</p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                navigateTransactionView(
                  view === "import" ? "import" : "settings",
                )
              }
            >
              Correct {view === "import" ? "input" : "settings"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setError(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {view === "import" && (
        <section aria-label="Import transactions" className="max-w-2xl">
          <Tabs value={source} onValueChange={switchSource}>
            <TabsList variant="line" className="mb-6">
              <TabsTrigger value="upload" disabled={busy}>
                CSV file
              </TabsTrigger>
              <TabsTrigger value="sample" disabled={busy}>
                Examples
              </TabsTrigger>
            </TabsList>
            <TabsContent value="upload">
              <div
                className={cn(
                  "flex min-h-64 flex-col items-center justify-center gap-4 border border-dashed p-8 text-center",
                  dragOver && "bg-accent",
                )}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={dropFile}
              >
                {fileName ? (
                  <CheckIcon
                    aria-hidden="true"
                    className="size-8 text-muted-foreground"
                  />
                ) : (
                  <UploadIcon
                    aria-hidden="true"
                    className="size-8 text-muted-foreground"
                  />
                )}
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium break-all">
                    {fileName ?? "Drop a CSV here"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fileName
                      ? `${transactions.length} transactions ready`
                      : "Up to 25 rows · 64 KB"}
                  </p>
                </div>
                <Input
                  ref={fileRef}
                  className="sr-only"
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="Upload transaction CSV"
                  disabled={busy}
                  onChange={handleFile}
                />
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  {fileName ? "Change file" : "Choose CSV"}
                </Button>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Date, Description, Amount, Currency
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  nativeButton={false}
                  render={
                    <a
                      href="/examples/amex-synthetic-transactions.csv"
                      download
                    />
                  }
                >
                  <DownloadIcon data-icon="inline-start" /> Mock Amex CSV
                </Button>
              </div>
              {transactions.length > 0 && (
                <Field orientation="horizontal" className="mt-6">
                  <Checkbox
                    id="synthetic"
                    checked={syntheticData}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      setSyntheticData(Boolean(checked))
                    }
                  />
                  <FieldLabel
                    htmlFor="synthetic"
                    className="text-xs font-normal"
                  >
                    This file contains only fictional, synthetic transactions.
                  </FieldLabel>
                </Field>
              )}
            </TabsContent>
            <TabsContent value="sample">
              <FieldSet>
                <FieldLegend>Choose examples</FieldLegend>
                <FieldGroup>
                  {mockTransactions.map((row) => (
                    <Field key={row.id} orientation="horizontal">
                      <Checkbox
                        id={`mock-${row.id}`}
                        checked={selectedIds.includes(row.id)}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          toggleSample(row.id, Boolean(checked))
                        }
                      />
                      <FieldLabel
                        htmlFor={`mock-${row.id}`}
                        className="text-sm font-normal"
                      >
                        {row.description}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>
            </TabsContent>
          </Tabs>
          {transactions.length > 0 && needsSynthetic && (
            <p className="mt-4 text-xs text-muted-foreground">
              Confirm fictional data above to continue with {model.label}.
            </p>
          )}
          <div className="mt-8 flex items-center justify-between gap-4 border-t pt-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigateTransactionView("models")}
            >
              <ArrowLeftIcon data-icon="inline-start" /> Choose a model
            </Button>
            <Button
              disabled={!transactions.length || busy || needsSynthetic}
              onClick={() => navigateTransactionView("step")}
            >
              Next: run the demo <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>
        </section>
      )}

      {view !== "models" &&
        view !== "import" &&
        view !== "settings" &&
        !transactions.length && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No transactions yet</EmptyTitle>
              <EmptyDescription>
                Import a CSV or choose a few fictional examples.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => navigateTransactionView("import")}>
                Add transactions
              </Button>
            </EmptyContent>
          </Empty>
        )}

      {view === "transactions" && transactions.length > 0 && (
        <section aria-label="Transactions" className="flex flex-col gap-4">
          {latest && (
            <div className="flex flex-col gap-2" role="status">
              <p className="text-sm text-muted-foreground">
                {latest.state === "failed"
                  ? "Run needs attention"
                  : busy
                    ? "Processing"
                    : "Run complete"}{" "}
                · {completed} / {total} finished · {reviews} for review
                {reconnects ? ` · reconnecting (${reconnects}/3)` : ""}
              </p>
              {busy && (
                <Progress value={total ? (completed / total) * 100 : 0}>
                  <ProgressLabel className="sr-only">
                    Workflow completion
                  </ProgressLabel>
                </Progress>
              )}
            </div>
          )}
          {needsSynthetic && (
            <p className="text-sm text-destructive">
              Confirm fictional data in Add transactions before using{" "}
              {model.label}.
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Inspect</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-80">
                    <button
                      type="button"
                      className="text-left text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => openRow(row.id)}
                    >
                      {row.description}
                    </button>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">
                    {amount(row)}
                  </TableCell>
                  <TableCell>
                    {row.category ??
                      (row.movement === "transfer" ? "Own transfer" : "—")}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.status === "failed" ? "destructive" : "outline"
                      }
                    >
                      {executionStatusLabel(
                        row,
                        [...experiments]
                          .reverse()
                          .find((run) =>
                            run.progress.rows.some(
                              (item) => item.id === row.id,
                            ),
                          ),
                      )}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Inspect ${row.description}`}
                      onClick={() => openRow(row.id)}
                    >
                      <ArrowRightIcon />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-between gap-4 border-t pt-6">
            <Button
              variant="ghost"
              onClick={() => navigateTransactionView("step")}
            >
              <ArrowLeftIcon data-icon="inline-start" /> Watch the steps
            </Button>
            <Button onClick={() => navigateTransactionView("compare")}>
              Next: compare models <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>
        </section>
      )}

      {(view === "step" || view === "live") && selectedRow && (
        <section className="flex min-w-0 flex-col gap-6">
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => navigateTransactionView("import")}
          >
            <ArrowLeftIcon data-icon="inline-start" /> Add transactions
          </Button>
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-0 flex-1">
              <TransactionPicker
                rows={transactions}
                value={selectedRowId}
                onChange={selectRow}
              />
            </div>
            {rowRuns.length > 1 && (
              <Field className="w-full sm:w-56">
                <FieldLabel htmlFor="inspect-run">Run</FieldLabel>
                <Select
                  value={inspectedRun?.key ?? ""}
                  onValueChange={(value) => setSelectedExperiment(value)}
                  items={rowRuns.map((run, index) => ({
                    value: run.key,
                    label: `${index + 1}. ${getDecisionModel(run.modelId).label}`,
                  }))}
                >
                  <SelectTrigger id="inspect-run" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {rowRuns.map((run, index) => (
                        <SelectItem key={run.key} value={run.key}>
                          {index + 1}. {getDecisionModel(run.modelId).label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Button
              variant={inspectedRun?.runId ? "outline" : "default"}
              disabled={runDisabled}
              onClick={() =>
                void startRun(
                  inspectedRun?.runId
                    ? [transactions.find((row) => row.id === selectedRow.id)!]
                    : transactions,
                )
              }
            >
              {busy ? (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : inspectedRun?.runId ? (
                <RotateCcwIcon data-icon="inline-start" />
              ) : (
                <PlayIcon data-icon="inline-start" />
              )}
              {busy
                ? "Processing…"
                : inspectedRun?.runId
                  ? `Rerun with ${model.label}`
                  : `Start demo · ${transactions.length} ${transactions.length === 1 ? "row" : "rows"}`}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <p role="status">
              {latest
                ? `${completed} of ${total} finished · ${reviews} for review`
                : `${model.label} · ${transactions.length} ${transactions.length === 1 ? "transaction" : "transactions"} ready`}
              {reconnects ? ` · reconnecting (${reconnects}/3)` : ""}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                navigateTransactionView(view === "step" ? "live" : "step")
              }
            >
              {view === "step"
                ? "Switch to full speed"
                : "Switch to one step at a time"}
            </Button>
          </div>
          <DecisionInspector
            key={`${selectedRow.id}-${inspectedRun?.key ?? "preview"}`}
            row={
              inspectedRun
                ? selectedRow
                : { ...selectedRow, modelId, rulesApplied: useRules }
            }
            history={inspectedRun?.progress.histories.get(selectedRow.id) ?? []}
            mode={view === "step" ? "step" : "live"}
            focused={true}
            started={Boolean(inspectedRun?.runId)}
            finished={
              isTerminalStatus(selectedRow.status) ||
              Boolean(inspectedRun && inspectedRun.state === "failed")
            }
          />
          {latest?.runId && !busy && (
            <Button
              className="self-end"
              onClick={() => navigateTransactionView("transactions")}
            >
              Next: view results <ArrowRightIcon data-icon="inline-end" />
            </Button>
          )}
          {needsSynthetic && (
            <p className="text-sm text-destructive">
              Confirm fictional data in Add transactions before using{" "}
              {model.label}.
            </p>
          )}
        </section>
      )}

      {view === "compare" && selectedRow && (
        <section aria-label="Model comparisons" className="flex flex-col gap-8">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-0 flex-1">
              <TransactionPicker
                rows={transactions}
                value={selectedRowId}
                onChange={selectRow}
              />
            </div>
            <div className="w-full sm:w-60">
              <DecisionModelSelect
                value={modelId}
                onChange={setModelId}
                disabled={busy}
                label="Compare with"
              />
            </div>
            <Button
              disabled={runDisabled}
              onClick={() =>
                void startRun([
                  transactions.find((row) => row.id === selectedRow.id)!,
                ])
              }
            >
              {busy ? (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : (
                <PlayIcon data-icon="inline-start" />
              )}
              {busy ? "Processing…" : "Run comparison"}
            </Button>
          </div>
          {needsSynthetic && (
            <p className="text-sm text-destructive">
              Confirm fictional data in Add transactions before using{" "}
              {model.label}.
            </p>
          )}
          {rowRuns.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Path</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Min. selected P</TableHead>
                    <TableHead>Score / 2</TableHead>
                    <TableHead>P(own account)</TableHead>
                    <TableHead className="text-right">Request ms</TableHead>
                    <TableHead>
                      <span className="sr-only">Inspect</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rowRuns.map((run, index) => {
                    const row = run.progress.rows.find(
                      (item) => item.id === selectedRowId,
                    )!;
                    return (
                      <TableRow key={run.key}>
                        <TableCell>
                          {index + 1}. {getDecisionModel(run.modelId).label}
                        </TableCell>
                        <TableCell>
                          {row.source === "rule"
                            ? "Rule · model skipped"
                            : run.useRules
                              ? "Rules → model"
                              : "Model only"}
                        </TableCell>
                        <TableCell>
                          {run.state === "failed" && !run.runId
                            ? "Run not started"
                            : rowStatusLabel(row.status)}
                          {row.category && (
                            <span className="block text-xs text-muted-foreground">
                              {row.category}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {row.source === "rule"
                            ? "—"
                            : probabilityLabel(row.confidence)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {row.trace?.answers.evidence.score.toFixed(3) ?? "—"}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {row.trace
                            ? probabilityLabel(
                                row.trace.answers.ownAccount.probability,
                              )
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.trace?.elapsedMs.toLocaleString() ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Inspect comparison run ${index + 1}`}
                            onClick={() => {
                              setSelectedExperiment(run.key);
                              navigateTransactionView("step");
                            }}
                          >
                            <ArrowRightIcon />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">
                Same input and questions. Timings include Gateway and retries;
                individual runs are not a benchmark.
              </p>
            </>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No comparisons yet</EmptyTitle>
                <EmptyDescription>
                  Run this transaction with Jev, then select another model.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      )}

      {view === "settings" && (
        <section aria-label="Run settings" className="max-w-xl">
          <FieldGroup>
            <Field orientation="horizontal">
              <Checkbox
                id="apply-rules"
                checked={useRules}
                disabled={busy}
                onCheckedChange={(checked) => setUseRules(Boolean(checked))}
              />
              <FieldLabel htmlFor="apply-rules">
                Check simple rules first
              </FieldLabel>
            </Field>
            <FieldDescription>
              Uncheck to send every row to the model, including explicit
              transfers and fees.
            </FieldDescription>
            {localDevelopment ? (
              <p className="text-sm text-muted-foreground">
                Local mode uses the server’s environment configuration. No
                access token entry is needed.
              </p>
            ) : (
              <Field>
                <FieldLabel htmlFor="demo-token">Demo access token</FieldLabel>
                <Input
                  id="demo-token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Enter the configured demo token"
                />
                <FieldDescription>
                  Kept in this tab’s memory. Model API keys remain on the
                  server.
                </FieldDescription>
              </Field>
            )}
          </FieldGroup>
          <details className="mt-8 border-t pt-5 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Data and retention</summary>
            <p className="mt-3 leading-relaxed">
              {model.zeroDataRetention
                ? "This model requests Gateway zero data retention."
                : "This model requires explicitly acknowledged synthetic data; Gateway zero retention is not available."}{" "}
              Workflow stores run inputs, answers, and progress under its
              configured retention. Comparisons are held in tab memory and clear
              on reload. No financial action is taken.
            </p>
          </details>
        </section>
      )}
    </div>
  );
}
