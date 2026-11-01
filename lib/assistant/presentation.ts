import type { CalendarEvent } from "./calendar";

export function eventBoundaryLabel(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "long",
    timeZone,
  }).format(new Date(value));
}

/** Google date-only boundaries are calendar dates; the end date is exclusive. */
export function calendarEventWhen(
  event: CalendarEvent,
  calendarTimeZone = "UTC",
): string {
  if (event.allDay) {
    const date = new Date(`${event.start}T12:00:00Z`);
    const day = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
    return `${day} · All day`;
  }
  const timeZone = event.timeZone ?? calendarTimeZone;
  const when = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(event.start));
  return `${when} · ${timeZone}`;
}
