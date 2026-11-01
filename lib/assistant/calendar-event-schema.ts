import { z } from "zod";

export function isCalendarTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/** One timed, private event. Unknown fields cannot smuggle attendees or calendar IDs. */
export const calendarEventDraftSchema = z.strictObject({
  summary: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  timeZone: z.string().trim().min(1).max(100).refine(isCalendarTimeZone, "Choose a valid IANA time zone."),
}).superRefine((draft, context) => {
  const duration = Date.parse(draft.end) - Date.parse(draft.start);
  if (duration < 5 * 60_000 || duration > 480 * 60_000 || !Number.isInteger(duration / 60_000))
    context.addIssue({ code: "custom", path: ["end"], message: "Event duration must be 5–480 whole minutes." });
});

export type CalendarEventDraft = z.infer<typeof calendarEventDraftSchema>;

/** Called at proposal and write time; time-sensitive checks never rely on model policy. */
export function validateCalendarEventDraft(raw: unknown, now = new Date()): CalendarEventDraft {
  const draft = calendarEventDraftSchema.parse(raw);
  const start = Date.parse(draft.start);
  const maximumStart = now.getTime() + 365 * 24 * 60 * 60 * 1000;
  if (start <= now.getTime() || start > maximumStart)
    throw new Error("Choose an event start in the future, within the next 365 days.");
  return { ...draft, start: new Date(start).toISOString(), end: new Date(draft.end).toISOString() };
}
