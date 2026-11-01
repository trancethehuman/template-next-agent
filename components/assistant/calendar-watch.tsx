"use client";

import {
  ArrowRightIcon,
  ClockIcon,
  EyeIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
} from "lucide-react";
import { FlowDiagram } from "@/components/assistant/stage-map";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CalendarStatus } from "@/lib/assistant/calendar";
import {
  calloutLabels,
  type CalendarCallout,
  type NextCheck,
} from "@/lib/assistant/calendar-callouts";
import { previewStageMap } from "@/lib/assistant/stage-map";

const shownCallouts = 12;

export const watchRequest = "Watch my calendar this week and tell me what needs a look.";

/** Everything a watch flagged at one check. “New” marks what it hadn’t sent before. */
export function CalloutList({
  callouts,
}: {
  callouts: Array<CalendarCallout & { fresh: boolean }>;
}) {
  if (!callouts.length) return null;
  // On a first check everything is new, so the badge would add nothing.
  const marksNew = callouts.some((callout) => !callout.fresh);
  return (
    <ul aria-label="What it flagged" className="flex flex-col gap-3">
      {callouts.slice(0, shownCallouts).map((callout) => (
        <li key={callout.key} className="flex items-start gap-3 text-sm">
          <span className="w-24 shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">
            {calloutLabels[callout.kind]}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="break-words leading-6">{callout.text}</span>
            <span className="text-xs text-muted-foreground">{callout.when}</span>
          </span>
          {marksNew && callout.fresh && <Badge>New</Badge>}
        </li>
      ))}
      {callouts.length > shownCallouts && (
        <li className="text-xs text-muted-foreground">
          And {callouts.length - shownCallouts} more.
        </li>
      )}
    </ul>
  );
}

/** The check a watch scheduled for itself, with the same moment as a cron line. */
export function NextCheckLine({ nextCheck }: { nextCheck: NextCheck }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-muted px-3 py-2 text-sm">
      <ClockIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="font-medium tabular-nums">{nextCheck.label}</span>
      <code className="font-mono text-xs text-muted-foreground">cron {nextCheck.cron}</code>
    </p>
  );
}

/** Before a watch exists: what it will do, and the one button that starts it. */
export function CalendarWatchStart({
  status,
  loading,
  error,
  starting,
  onStart,
  onConnect,
  onRefresh,
}: {
  status?: CalendarStatus;
  loading: boolean;
  error?: string;
  starting: boolean;
  onStart: () => void;
  onConnect: () => void;
  onRefresh: () => void;
}) {
  const connected = status?.state === "connected";
  return (
    <section
      aria-label="Watch your calendar"
      className="grid min-w-0 items-start gap-8 rounded-lg border p-4 sm:p-6 lg:grid-cols-12"
    >
      <div className="flex min-w-0 flex-col gap-6 lg:order-2 lg:col-span-7">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold tracking-tight">
            {connected || loading ? "Watch your real calendar" : "Connect your calendar"}
          </h2>
          <p className="max-w-xl leading-7 text-muted-foreground">
            It reads your next 7 days, then messages you about clashes,
            cancellations, people who declined, and invites you haven’t
            answered. It never changes your calendar or contacts anyone.
          </p>
        </div>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <LoaderCircleIcon className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            Checking your calendar connection…
          </p>
        ) : connected ? (
          <Button size="lg" className="self-start" disabled={starting} onClick={onStart}>
            {starting ? (
              <LoaderCircleIcon className="motion-safe:animate-spin" data-icon="inline-start" />
            ) : (
              <EyeIcon data-icon="inline-start" />
            )}
            {starting ? "Starting…" : "Start watching"}
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            {status?.message && (
              <p className="max-w-xl text-sm leading-6" role="status">
                {status.message}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {status?.canAuthorize && (
                <Button onClick={onConnect}>
                  Connect Google Calendar
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              )}
              <Button variant="outline" onClick={onRefresh}>
                <RefreshCwIcon data-icon="inline-start" />
                Check again
              </Button>
            </div>
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          Read-only and private to your account. Credentials stay on the server.
        </p>
      </div>
      <div className="min-w-0 lg:order-1 lg:col-span-5">
        <FlowDiagram
          map={previewStageMap("calendar_watch")}
          request={{ label: "Your request", text: watchRequest }}
        />
      </div>
    </section>
  );
}
