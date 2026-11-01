import { describe, expect, test } from "bun:test";
import {
  planNextCheck,
  reviewCalendar,
  type ScanEvent,
} from "@/lib/assistant/calendar-callouts";

// Fictional week in Toronto. Monday, November 2, 2026 is after the DST change.
const timeZone = "America/Toronto";
const now = new Date("2026-11-02T09:00:00-05:00");
const windowEnd = new Date("2026-11-09T09:00:00-05:00");

function event(id: string, title: string, start: string, end: string, extra: Partial<ScanEvent> = {}): ScanEvent {
  return {
    id,
    title,
    start: `2026-11-${start}-05:00`,
    end: `2026-11-${end}-05:00`,
    allDay: false,
    cancelled: false,
    free: false,
    marker: false,
    organizedByYou: false,
    yourResponse: "accepted",
    guests: [],
    ...extra,
  };
}

const guest = (name: string, response: ScanEvent["guests"][number]["response"]) => ({
  key: `hash-${name.toLowerCase()}`,
  name,
  response,
});

const week: ScanEvent[] = [
  event("review", "Design review", "02T10:00:00", "02T11:00:00"),
  event("alex", "1:1 with Alex", "02T10:30:00", "02T11:15:00"),
  event("sync", "Launch sync", "02T11:15:00", "02T12:00:00"),
  event("planning", "Planning", "02T12:00:00", "02T13:00:00"),
  event("audit", "Accessibility audit", "03T14:00:00", "03T15:00:00", {
    organizedByYou: true,
    guests: [guest("Priya", "declined"), guest("Sam", "accepted")],
  }),
  event("allhands", "All hands", "04T09:00:00", "04T10:00:00", {
    guests: Array.from({ length: 20 }, (_, index) => guest(`Guest${index}`, index < 3 ? "declined" : "accepted")),
  }),
  event("vendor", "Vendor call", "04T13:00:00", "04T14:00:00", { yourResponse: "needsAction" }),
  // Free time, working-location markers, and meetings you declined never clash.
  event("focus", "Focus block", "02T10:00:00", "02T12:00:00", { free: true }),
  event("home", "Home", "02T09:00:00", "02T17:00:00", { marker: true }),
  event("skipped", "Old standup", "02T10:15:00", "02T10:45:00", { yourResponse: "declined" }),
  // Only recent cancellations by someone else are news on a first check.
  event("offsite", "Offsite planning", "05T10:00:00", "05T11:00:00", {
    cancelled: true,
    updated: "2026-11-02T13:00:00Z",
  }),
  event("stale", "Stale cancellation", "05T12:00:00", "05T13:00:00", {
    cancelled: true,
    updated: "2026-10-20T13:00:00Z",
  }),
  event("mine", "My cancelled block", "05T15:00:00", "05T16:00:00", {
    cancelled: true,
    organizedByYou: true,
    updated: "2026-11-02T13:00:00Z",
  }),
];

const first = () =>
  reviewCalendar({ events: week, now, timeZone, windowEnd, truncated: false, lastCheck: false });

describe("calendar callouts", () => {
  test("a first check flags clashes, declines, replies owed, crowded days, and recent cancellations", () => {
    const review = first();
    expect(review.callouts.map((callout) => [callout.kind, callout.text])).toEqual([
      ["back_to_back", "4 meetings back to back, no break"],
      ["conflict", "“Design review” overlaps “1:1 with Alex”"],
      ["declined", "Priya declined “Accessibility audit”"],
      ["needs_reply", "You haven’t replied to “Vendor call”"],
      ["cancelled", "“Offsite planning” was cancelled"],
    ]);
    expect(review.callouts.every((callout) => callout.fresh)).toBe(true);
    expect(review.callouts[0].when).toBe("Mon, Nov 2, 10:00 AM–1:00 PM");
    expect(review.callouts[1].when).toBe("Mon, Nov 2, 10:30–11:00 AM");
    expect(review.events).toBe(9);
  });

  test("it messages only the owner, lists what it found, and says when it will look again", () => {
    const { message, nextCheck } = first();
    expect(nextCheck).toMatchObject({
      label: "9:45 AM",
      reason: "15 minutes before “Design review”",
      cron: "45 9 2 11 *",
    });
    expect(message).toStartWith("5 things on your calendar need a look:");
    expect(message).toContain("- **Clash** · “Design review” overlaps “1:1 with Alex” · Mon, Nov 2, 10:30–11:00 AM");
    expect(message).toContain("- **Cancelled** · “Offsite planning” was cancelled");
    expect(message).toEndWith("I’ll check again at 9:45 AM, 15 minutes before “Design review”.");
    expect(message).not.toContain("Guest");
  });

  test("a later check reports moves and disappearances once, and stays quiet when nothing changed", () => {
    const { memory } = first();
    const later = new Date("2026-11-02T09:45:00-05:00");
    const moved = week
      .filter((item) => item.id !== "vendor")
      .map((item) => (item.id === "review" ? { ...item, start: "2026-11-02T14:00:00-05:00", end: "2026-11-02T15:00:00-05:00" } : item));
    const second = reviewCalendar({ events: moved, now: later, timeZone, windowEnd, truncated: false, memory, lastCheck: false });
    const fresh = second.callouts.filter((callout) => callout.fresh);
    expect(fresh.map((callout) => [callout.kind, callout.text])).toEqual([
      ["moved", "“Design review” moved from Mon, Nov 2, 10:00–11:00 AM"],
      ["cancelled", "“Vendor call” was cancelled or removed"],
    ]);
    // The clash went away with the move; what was already sent is not repeated.
    expect(second.callouts.some((callout) => callout.kind === "conflict")).toBe(false);
    expect(second.callouts.find((callout) => callout.kind === "declined")?.fresh).toBe(false);
    expect(second.message).toStartWith("Since my last check, 2 things changed:");

    const third = reviewCalendar({ events: moved, now: later, timeZone, windowEnd, truncated: false, memory: second.memory, lastCheck: false });
    expect(third.callouts.some((callout) => callout.fresh)).toBe(false);
    expect(third.message).toBeUndefined();
  });

  test("a clear first check still says so, and the last check promises nothing more", () => {
    const clear = reviewCalendar({ events: [], now, timeZone, windowEnd, truncated: false, lastCheck: true });
    expect(clear.callouts).toEqual([]);
    expect(clear.message).toStartWith("Your next 7 days look clear");
    expect(clear.message).toEndWith("That was my only check.");
  });

  test("a truncated read never reports events past what it returned as removed", () => {
    const memory = {
      seen: { saturday: { title: "Saturday brunch", start: "2026-11-07T11:00:00-05:00", end: "2026-11-07T12:00:00-05:00" } },
      sent: [],
    };
    const review = reviewCalendar({
      events: [event("review", "Design review", "02T10:00:00", "02T11:00:00")],
      now, timeZone, windowEnd, truncated: true, memory, lastCheck: false,
    });
    expect(review.callouts).toEqual([]);
  });

  test("with nothing coming up, it schedules its own check in two hours", () => {
    expect(planNextCheck([], now, timeZone)).toEqual({
      at: "2026-11-02T16:00:00.000Z",
      label: "11:00 AM",
      reason: "to catch any changes",
      cron: "0 11 2 11 *",
    });
  });
});
