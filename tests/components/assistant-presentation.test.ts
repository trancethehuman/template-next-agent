import { describe, expect, test } from "bun:test";
import { calendarEventWhen, eventBoundaryLabel } from "@/lib/assistant/presentation";
import type { CalendarEvent } from "@/lib/assistant/calendar";

describe("calendar presentation", () => {
  test("event approval distinguishes the two 1:30 AM instants at daylight-saving fallback", () => {
    const first = eventBoundaryLabel("2026-11-01T05:30:00Z", "America/Toronto");
    const second = eventBoundaryLabel("2026-11-01T06:30:00Z", "America/Toronto");
    expect(first).toContain("1:30");
    expect(second).toContain("1:30");
    expect(first).not.toBe(second);
  });

  test("all-day dates retain their calendar day across browser time zones", () => {
    const event: CalendarEvent = {
      id: "synthetic-day",
      title: "Fictional planning day",
      start: "2026-10-30",
      end: "2026-10-31",
      allDay: true,
    };
    const label = calendarEventWhen(event, "America/Toronto");
    expect(label).toContain("30");
    expect(label).not.toContain("29");
    expect(label).toContain("All day");
  });

  test("timed events use the named calendar zone rather than the browser zone", () => {
    const event: CalendarEvent = {
      id: "synthetic-call",
      title: "Fictional call",
      start: "2026-10-30T14:00:00Z",
      end: "2026-10-30T15:00:00Z",
      allDay: false,
      timeZone: "America/Toronto",
    };
    const label = calendarEventWhen(event, "Europe/London");
    expect(label).toContain("10:00");
    expect(label).toContain("America/Toronto");
    expect(label).not.toContain("Europe/London");
  });
});
