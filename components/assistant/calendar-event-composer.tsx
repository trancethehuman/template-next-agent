"use client";

import { useRef, useState } from "react";
import { CalendarPlusIcon, LoaderCircleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { assistantRequest, errorMessage } from "@/lib/assistant/client";

function localDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function initialTimes() {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  return {
    start: localDateTime(start),
    end: localDateTime(new Date(start.getTime() + 30 * 60 * 1000)),
  };
}

/** This form queues an immutable draft. Only the inbox's owner decision writes it. */
export function CalendarEventComposer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (runId: string) => void;
}) {
  const [times] = useState(initialTimes);
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState(times.start);
  const [end, setEnd] = useState(times.end);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<{ body: string; key: string } | undefined>(undefined);

  async function propose() {
    if (pending) return;
    setError(undefined);
    setPending(true);
    try {
      const body = JSON.stringify({
        kind: "calendar_event",
        eventDraft: {
          summary: summary.trim(),
          description: description.trim() || undefined,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          timeZone,
        },
      });
      if (request.current?.body !== body)
        request.current = { body, key: crypto.randomUUID() };
      const data = await assistantRequest<{ runId: string }>(
        "/api/assistant/tasks",
        {
          method: "POST",
          headers: { "x-assistant-idempotency-key": request.current.key },
          body,
        },
      );
      onCreated(data.runId);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <SheetContent size="wide" className="gap-0">
        <SheetHeader className="border-b p-6 pr-12">
          <SheetTitle>Draft a calendar event</SheetTitle>
          <SheetDescription>
            Review the exact event in your inbox before approving creation.
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6"
          onSubmit={(event) => {
            event.preventDefault();
            void propose();
          }}
        >
          <Field>
            <FieldLabel htmlFor="calendar-event-summary">
              Event title
            </FieldLabel>
            <Input
              id="calendar-event-summary"
              required
              maxLength={160}
              placeholder="A focused hour for the launch plan"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="calendar-event-start">Starts</FieldLabel>
              <Input
                id="calendar-event-start"
                type="datetime-local"
                required
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="calendar-event-end">Ends</FieldLabel>
              <Input
                id="calendar-event-end"
                type="datetime-local"
                required
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Times use your browser’s time zone:{" "}
            <span className="font-medium">{timeZone}</span>. The inbox shows the
            converted time before you approve.
          </p>
          <Field>
            <FieldLabel htmlFor="calendar-event-description">
              Notes (optional)
            </FieldLabel>
            <Textarea
              id="calendar-event-description"
              maxLength={2000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <FieldDescription>
              Creates a private event on the configured primary calendar,
              without attendees or reminders. Creating this draft does not write
              to Google.
            </FieldDescription>
          </Field>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Couldn’t prepare the event draft</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button className="mt-auto" type="submit" disabled={pending}>
            {pending ? (
              <LoaderCircleIcon
                className="motion-safe:animate-spin"
                data-icon="inline-start"
              />
            ) : (
              <CalendarPlusIcon data-icon="inline-start" />
            )}
            {pending ? "Preparing draft…" : "Review event in inbox"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
