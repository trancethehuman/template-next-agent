"use client";

import Link from "next/link";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CircleHelpIcon,
  FileSpreadsheetIcon,
  LoaderCircleIcon,
  PlayIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { Task, TaskContent, TaskItem, TaskTrigger } from "@/components/ai-elements/task";
import { RunStreamFatalError, watchRun } from "@/components/transactions/run-stream";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MAX_CSV_BYTES, parseTransactionCsv } from "@/lib/transactions/csv";
import { mockTransactions } from "@/lib/transactions/mock";
import type { ClassificationRow, ClassificationStatus, TransactionInput } from "@/lib/transactions/types";

type Source = "sample" | "upload";
type RunState = "idle" | "starting" | "running" | "completed" | "failed";

const terminalStatuses: ClassificationStatus[] = ["classified", "needs_review", "failed"];

function queueRows(transactions: TransactionInput[]): ClassificationRow[] {
  return transactions.map((transaction) => ({
    ...transaction,
    status: "queued",
    category: null,
    movement: null,
    confidence: null,
    source: null,
    reason: null,
  }));
}

function formatAmount(amountMinor: number, currency: TransactionInput["currency"]): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(amountMinor / 100);
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function statusBadge(status: ClassificationStatus) {
  switch (status) {
    case "queued":
      return <Badge variant="outline">Queued</Badge>;
    case "rules":
      return <Badge variant="secondary">Checking rules</Badge>;
    case "jev":
      return <Badge variant="secondary">Using Jev</Badge>;
    case "classified":
      return <Badge>Classified</Badge>;
    case "needs_review":
      return <Badge variant="outline">Review needed</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
  }
}

export function TransactionStatus({ row }: { row: ClassificationRow }) {
  return (
    <div className="flex max-w-64 flex-col items-start gap-1">
      {statusBadge(row.status)}
      {row.reason && terminalStatuses.includes(row.status) && (
        <span className="whitespace-normal break-words text-xs leading-snug text-muted-foreground">
          {row.reason}
        </span>
      )}
    </div>
  );
}

function responseMessage(response: Response, fallback: string): Promise<string> {
  return response
    .json()
    .then((body: unknown) => {
      if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
        return body.error;
      }
      return fallback;
    })
    .catch(() => fallback);
}

export function TransactionsPlayground() {
  const [source, setSource] = useState<Source>("sample");
  const [selectedSampleIds, setSelectedSampleIds] = useState<string[]>(
    () => mockTransactions.map((transaction) => transaction.id),
  );
  const [transactions, setTransactions] = useState<TransactionInput[]>(mockTransactions);
  const [rows, setRows] = useState<ClassificationRow[]>(() => queueRows(mockTransactions));
  const [fileName, setFileName] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [runState, setRunState] = useState<RunState>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const isBusy = runState === "starting" || runState === "running";
  const completedCount = rows.filter((row) => terminalStatuses.includes(row.status)).length;
  const reviewCount = rows.filter((row) => row.status === "needs_review").length;
  const progress = rows.length === 0 ? 0 : Math.round((completedCount / rows.length) * 100);
  const statusText =
    runState === "starting"
      ? "Starting workflow…"
      : runState === "running"
        ? reconnectCount > 0
          ? `Connection interrupted. Reconnecting (attempt ${reconnectCount} of 3)…`
          : `Processing ${completedCount} of ${rows.length} transactions…`
          : runState === "completed"
          ? `Completed ${completedCount} ${completedCount === 1 ? "transaction" : "transactions"}${reviewCount ? `; ${reviewCount} need review` : ""}.`
          : runState === "failed"
            ? "Workflow needs attention."
            : "Ready to classify.";

  function reset(nextSource: Source) {
    abortRef.current?.abort();
    abortRef.current = null;
    setSource(nextSource);
    if (nextSource === "sample") setSelectedSampleIds(mockTransactions.map((transaction) => transaction.id));
    const nextTransactions = nextSource === "sample" ? mockTransactions : [];
    setTransactions(nextTransactions);
    setRows(queueRows(nextTransactions));
    setFileName(null);
    setRunState("idle");
    setRunId(null);
    setReconnectCount(0);
    setError(null);
  }

  function toggleSample(id: string) {
    if (isBusy) return;
    const nextIds = selectedSampleIds.includes(id)
      ? selectedSampleIds.filter((selectedId) => selectedId !== id)
      : [...selectedSampleIds, id];
    const nextTransactions = mockTransactions.filter((transaction) => nextIds.includes(transaction.id));
    setSelectedSampleIds(nextIds);
    setTransactions(nextTransactions);
    setRows(queueRows(nextTransactions));
    setRunState("idle");
    setRunId(null);
    setReconnectCount(0);
    setError(null);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    abortRef.current?.abort();
    setRunState("idle");
    setRunId(null);
    setReconnectCount(0);
    setFileName(null);
    setError(null);
    setTransactions([]);
    setRows([]);

    if (file.size > MAX_CSV_BYTES) {
      setError("CSV file is too large. Choose a file under 64 KB.");
      return;
    }
    try {
      const parsed = parseTransactionCsv(await file.text());
      setTransactions(parsed);
      setRows(queueRows(parsed));
      setFileName(file.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CSV could not be read.");
    }
  }

  async function startRun() {
    if (transactions.length === 0 || isBusy) return;

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setRows(queueRows(transactions));
    setRunState("starting");
    setRunId(null);
    setReconnectCount(0);
    setError(null);

    const authorization = token.trim();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authorization) headers.Authorization = `Bearer ${authorization}`;

    try {
      const created = await fetch("/api/runs", {
        method: "POST",
        headers,
        body: JSON.stringify({ transactions }),
        signal: controller.signal,
      });
      if (!created.ok) {
        throw new Error(await responseMessage(created, "Could not start the classification run."));
      }
      const body: unknown = await created.json();
      if (!body || typeof body !== "object" || !("runId" in body) || typeof body.runId !== "string") {
        throw new Error("The run did not return an ID.");
      }
      const createdRunId = body.runId;
      setRunId(createdRunId);
      setRunState("running");

      await watchRun(
        async (startIndex) => {
          const stream = await fetch(
            `/api/runs/${encodeURIComponent(createdRunId)}/stream?startIndex=${startIndex}`,
            {
              headers: authorization ? { Authorization: `Bearer ${authorization}` } : undefined,
              cache: "no-store",
              signal: controller.signal,
            },
          );
          if (!stream.ok) {
            const message = await responseMessage(stream, "Could not connect to the live run.");
            if (stream.status < 500) throw new RunStreamFatalError(message);
            throw new Error(message);
          }
          if (!stream.body) throw new Error("The live run did not return a status stream.");
          setReconnectCount(0);
          return stream.body;
        },
        (event) => {
          if (event.type === "row") {
            setRows((current) => current.map((row) => (row.id === event.row.id ? event.row : row)));
            return;
          }
          setRunState(event.status === "completed" ? "completed" : "failed");
          if (event.status === "failed") setError("One or more rows could not be classified. Check AI Gateway access and try again.");
        },
        controller.signal,
        setReconnectCount,
      );
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "The classification run failed.");
      setRunState("failed");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5">
          <Link className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground" href="/">
            <ArrowLeftIcon aria-hidden="true" className="size-4" />
            Use case directory
          </Link>
          <Badge variant="outline">Example 01</Badge>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-10 sm:py-14">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <FileSpreadsheetIcon aria-hidden="true" className="size-4" />
            FINANCIAL WORKFLOWS
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Classify transactions
          </h1>
          <p className="max-w-3xl text-muted-foreground">
            Start with fictional records or preview your own CSV. Follow every transaction
            as rules and Jev produce a category, movement, and review status.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Choose transactions</CardTitle>
              <CardDescription>Sample data is ready. CSV files are parsed in your browser before a run starts.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={source} onValueChange={(value) => reset(value as Source)}>
                <TabsList>
                  <TabsTrigger disabled={isBusy} value="sample">Sample data</TabsTrigger>
                  <TabsTrigger disabled={isBusy} value="upload">Upload CSV</TabsTrigger>
                </TabsList>
                <TabsContent className="pt-4" value="sample">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <p className="text-muted-foreground">Choose which fictional transactions to classify.</p>
                      <span className="font-medium">{selectedSampleIds.length} selected</span>
                    </div>
                    <div className="max-h-64 overflow-y-auto rounded-lg border bg-background">
                      {mockTransactions.map((transaction) => (
                        <label className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0" key={transaction.id}>
                          <input
                            checked={selectedSampleIds.includes(transaction.id)}
                            className="size-4 accent-primary"
                            disabled={isBusy}
                            onChange={() => toggleSample(transaction.id)}
                            type="checkbox"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm">{transaction.description}</span>
                          <span className="text-xs tabular-nums text-muted-foreground">{formatAmount(transaction.amountMinor, transaction.currency)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </TabsContent>
                <TabsContent className="pt-4" value="upload">
                  <div className="flex flex-col gap-3">
                    <label className="text-sm font-medium" htmlFor="transaction-csv">Transaction CSV</label>
                    <Input
                      accept=".csv,text/csv"
                      disabled={isBusy}
                      id="transaction-csv"
                      onChange={handleFile}
                      type="file"
                    />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Up to 25 rows and 64 KB. Use date, description, and signed amount columns,
                      or date, description, debit, and credit. Currency is optional and defaults to CAD.
                      Dates can be YYYY-MM-DD or MM/DD/YYYY. Negative amounts are money out;
                      positive amounts are money in.
                    </p>
                    {fileName && <Badge variant="secondary">{fileName} · {transactions.length} rows</Badge>}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Run classification</CardTitle>
              <CardDescription>Results stream into the table as the workflow advances.</CardDescription>
              <CardAction>
                <Badge variant={runState === "failed" ? "destructive" : "outline"}>
                  {runState === "completed" ? "Complete" : isBusy ? "Live" : runState === "failed" ? "Failed" : "Ready"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="demo-token">Demo access token <span className="font-normal text-muted-foreground">(if configured)</span></label>
                <Input
                  autoComplete="off"
                  id="demo-token"
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Optional DEMO_ACCESS_TOKEN"
                  type="password"
                  value={token}
                />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Starting a run sends selected rows to this app&apos;s server. Ambiguous
                descriptions may be sent through the configured AI Gateway.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={isBusy || transactions.length === 0} onClick={startRun} size="lg">
                  {isBusy ? <LoaderCircleIcon aria-hidden="true" className="animate-spin" data-icon="inline-start" /> : <PlayIcon aria-hidden="true" data-icon="inline-start" />}
                  {isBusy ? "Classifying…" : runState === "completed" || runState === "failed" ? "Run again" : "Classify transactions"}
                </Button>
                {source === "upload" && transactions.length > 0 && (
                  <Button disabled={isBusy} onClick={() => reset("upload")} variant="ghost">
                    <RotateCcwIcon aria-hidden="true" data-icon="inline-start" />
                    Clear CSV
                  </Button>
                )}
              </div>
              <Task>
                <TaskTrigger title="What this workflow does" />
                <TaskContent>
                  <TaskItem>Validate rows and create a resumable run.</TaskItem>
                  <TaskItem>Apply deterministic rules to clear matches.</TaskItem>
                  <TaskItem>Use Jev for transactions that need model judgment.</TaskItem>
                  <TaskItem>Stream category and review decisions into the table.</TaskItem>
                </TaskContent>
              </Task>
            </CardContent>
          </Card>
        </div>

        {error && (
          <Alert variant="destructive">
            <CircleHelpIcon aria-hidden="true" />
            <AlertTitle>Could not continue</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Transactions</CardTitle>
            <CardDescription aria-live="polite">{statusText}</CardDescription>
            <CardAction><Badge variant="secondary">{rows.length} {rows.length === 1 ? "row" : "rows"}</Badge></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {(isBusy || runState === "completed" || runState === "failed") && rows.length > 0 && (
              <Progress value={progress}>
                <ProgressLabel>Processed</ProgressLabel>
                <ProgressValue>{() => `${completedCount} of ${rows.length}`}</ProgressValue>
              </Progress>
            )}
            <Table>
              <TableCaption>
                {rows.length > 0
                  ? `Preview of ${rows.length} ${source === "sample" ? "fictional" : "uploaded"} ${rows.length === 1 ? "transaction" : "transactions"}${runId ? ` in run ${runId}` : ""}.`
                  : source === "sample"
                    ? "Select sample transactions to preview them."
                    : "Choose a CSV file to preview its transactions."}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell className="py-12 text-center text-muted-foreground" colSpan={6}>
                      {source === "sample" ? "Select at least one sample transaction." : "Upload a CSV to see its rows here."}
                    </TableCell>
                  </TableRow>
                ) : rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-muted-foreground">{formatDate(row.date)}</TableCell>
                    <TableCell className="max-w-56 truncate font-medium" title={row.description}>{row.description}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span>{row.category ?? "—"}</span>
                        {row.source && <span className="text-xs text-muted-foreground">{row.source === "rule" ? "Rule" : "Jev"}{row.confidence != null ? ` · ${Math.round(row.confidence * 100)}% confidence` : ""}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">{row.movement ?? "—"}</TableCell>
                    <TableCell><TransactionStatus row={row} /></TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatAmount(row.amountMinor, row.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <p>Categories are a demo result. Review classifications before using them for accounting.</p>
          <Link className="inline-flex items-center gap-1 font-medium text-foreground hover:underline" href="/">
            Browse all use cases <ArrowRightIcon aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </main>
    </div>
  );
}
