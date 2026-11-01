/**
 * Finds what an always-on assistant should flag on a real calendar: clashes,
 * cancellations, moves, people who declined, invites you haven't answered,
 * and days with no break. Everything here is deterministic code over
 * provider fields; nothing is generated, and nothing is sent to anyone else.
 */

export type CalloutKind =
  | "conflict"
  | "cancelled"
  | "moved"
  | "declined"
  | "needs_reply"
  | "back_to_back";

export type GuestResponse = "accepted" | "declined" | "tentative" | "needsAction";

export interface ScanGuest {
  /** A short hash of the guest's email, never the address itself. */
  key: string;
  name: string;
  response: GuestResponse;
}

/** One calendar event, reduced to the fields the review needs. */
export interface ScanEvent {
  id: string;
  title: string;
  /** RFC 3339 date-time, or a date for all-day events. */
  start: string;
  end: string;
  allDay: boolean;
  cancelled: boolean;
  /** When the provider last changed the event. */
  updated?: string;
  /** Marked as free time, so it can't clash. */
  free: boolean;
  /** Working location and similar markers, which are never meetings. */
  marker: boolean;
  organizedByYou: boolean;
  yourResponse?: GuestResponse;
  guests: ScanGuest[];
  url?: string;
}

export interface CalendarCallout {
  key: string;
  kind: CalloutKind;
  /** One plain sentence, such as “Design review” overlaps “1:1 with Alex”. */
  text: string;
  when: string;
  start: string;
  url?: string;
}

export interface NextCheck {
  at: string;
  /** Local time, such as “3:45 PM” or “Tue 9:00 AM”. */
  label: string;
  reason: string;
  /** The same moment as a one-off cron expression, in the calendar's time zone. */
  cron: string;
}

export interface WatchMemory {
  /** Upcoming events seen at the last check, to tell what moved or disappeared. */
  seen: Record<string, { title: string; start: string; end: string }>;
  /** Callouts already messaged, so each is sent once. */
  sent: string[];
}

export interface CalendarReview {
  callouts: Array<CalendarCallout & { fresh: boolean }>;
  /** A message for the owner, only when something new was found. */
  message?: string;
  nextCheck: NextCheck;
  memory: WatchMemory;
  events: number;
}

export const calloutLabels: Record<CalloutKind, string> = {
  conflict: "Clash",
  cancelled: "Cancelled",
  moved: "Moved",
  declined: "Declined",
  needs_reply: "Reply needed",
  back_to_back: "No break",
};

const minute = 60_000;
const maxGuestsForDeclines = 12;
const recentCancellationMs = 72 * 60 * minute;
const messageItems = 6;

function at(value: string): number {
  return Date.parse(value);
}

function format(timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { timeZone, ...options });
}

function dayLabel(time: number, timeZone: string) {
  return format(timeZone, { weekday: "short", month: "short", day: "numeric" }).format(time);
}

function timeLabel(time: number, timeZone: string) {
  return format(timeZone, { hour: "numeric", minute: "2-digit" }).format(time);
}

/** “10:30–11:00 AM”, or “11:30 AM–1:00 PM” across noon. */
function timeRange(start: number, end: number, timeZone: string) {
  const from = timeLabel(start, timeZone);
  const to = timeLabel(end, timeZone);
  const period = (label: string) => label.split(/\s/).at(-1);
  return period(from) === period(to) ? `${from.replace(/\s\S+$/, "")}–${to}` : `${from}–${to}`;
}

function localDate(time: number, timeZone: string) {
  return format(timeZone, { year: "numeric", month: "2-digit", day: "2-digit" }).format(time);
}

function when(event: Pick<ScanEvent, "start" | "end" | "allDay">, timeZone: string): string {
  // All-day dates have no time zone; reading them as UTC keeps the date.
  if (event.allDay) return `${dayLabel(at(event.start), "UTC")} · all day`;
  return `${dayLabel(at(event.start), timeZone)}, ${timeRange(at(event.start), at(event.end), timeZone)}`;
}

function quote(title: string) {
  return `“${title}”`;
}

function names(guests: ScanGuest[]) {
  const shown = guests.slice(0, 2).map((guest) => guest.name);
  const rest = guests.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
  return shown.join(" and ");
}

/** Timed events you're expected at: the only ones that can clash or crowd a day. */
function attending(event: ScanEvent, now: number) {
  return (
    !event.allDay &&
    !event.cancelled &&
    !event.free &&
    !event.marker &&
    event.yourResponse !== "declined" &&
    at(event.end) > now
  );
}

function conflicts(events: ScanEvent[], now: number, timeZone: string): CalendarCallout[] {
  const timed = events.filter((event) => attending(event, now)).sort((a, b) => at(a.start) - at(b.start));
  const found: CalendarCallout[] = [];
  for (let i = 0; i < timed.length; i++)
    for (let j = i + 1; j < timed.length; j++) {
      const [a, b] = [timed[i], timed[j]];
      if (at(b.start) >= at(a.end)) break;
      // The same event copied onto two calendars is not a clash.
      if (a.title === b.title && a.start === b.start) continue;
      const start = Math.max(at(a.start), at(b.start));
      const end = Math.min(at(a.end), at(b.end));
      found.push({
        key: `conflict:${[a.id, b.id].sort().join(":")}`,
        kind: "conflict",
        text: `${quote(a.title)} overlaps ${quote(b.title)}`,
        when: `${dayLabel(start, timeZone)}, ${timeRange(start, end, timeZone)}`,
        start: new Date(start).toISOString(),
        url: a.url,
      });
    }
  return found;
}

function backToBack(events: ScanEvent[], now: number, timeZone: string): CalendarCallout[] {
  const days = new Map<string, ScanEvent[]>();
  for (const event of events.filter((item) => attending(item, now))) {
    const day = localDate(at(event.start), timeZone);
    days.set(day, [...(days.get(day) ?? []), event]);
  }
  const found: CalendarCallout[] = [];
  for (const [day, list] of days) {
    list.sort((a, b) => at(a.start) - at(b.start));
    let best: { start: number; end: number; count: number } | undefined;
    let chain = { start: at(list[0].start), end: at(list[0].end), count: 1 };
    for (const event of list.slice(1)) {
      if (at(event.start) - chain.end <= 5 * minute)
        chain = { start: chain.start, end: Math.max(chain.end, at(event.end)), count: chain.count + 1 };
      else chain = { start: at(event.start), end: at(event.end), count: 1 };
      if (chain.count >= 3 && chain.end - chain.start >= 150 * minute && (!best || chain.end - chain.start > best.end - best.start))
        best = { ...chain };
    }
    if (best)
      found.push({
        key: `busy:${day}`,
        kind: "back_to_back",
        text: `${best.count} meetings back to back, no break`,
        when: `${dayLabel(best.start, timeZone)}, ${timeRange(best.start, best.end, timeZone)}`,
        start: new Date(best.start).toISOString(),
      });
  }
  return found;
}

function people(events: ScanEvent[], now: number, timeZone: string): CalendarCallout[] {
  const found: CalendarCallout[] = [];
  for (const event of events) {
    if (event.cancelled || event.yourResponse === "declined" || at(event.end) <= now) continue;
    if (event.yourResponse === "needsAction" && !event.organizedByYou)
      found.push({
        key: `reply:${event.id}`,
        kind: "needs_reply",
        text: `You haven’t replied to ${quote(event.title)}`,
        when: when(event, timeZone),
        start: event.start,
        url: event.url,
      });
    if (event.guests.length > maxGuestsForDeclines) continue;
    const declined = event.guests.filter((guest) => guest.response === "declined");
    if (declined.length)
      found.push({
        key: `declined:${event.id}:${declined.map((guest) => guest.key).sort().join(",")}`,
        kind: "declined",
        text: `${names(declined)} declined ${quote(event.title)}`,
        when: when(event, timeZone),
        start: event.start,
        url: event.url,
      });
  }
  return found;
}

function changes(
  events: ScanEvent[],
  memory: WatchMemory | undefined,
  now: number,
  horizon: number,
  timeZone: string,
): CalendarCallout[] {
  const found: CalendarCallout[] = [];
  const current = new Map(events.filter((event) => !event.cancelled).map((event) => [event.id, event]));
  for (const event of events) {
    if (!event.cancelled || event.organizedByYou || at(event.start) <= now) continue;
    // On the first check, only recent cancellations are news.
    const known = Boolean(memory?.seen[event.id]);
    const recent = event.updated !== undefined && now - at(event.updated) <= recentCancellationMs;
    if (!known && !recent) continue;
    found.push({
      key: `cancelled:${event.id}`,
      kind: "cancelled",
      text: `${quote(memory?.seen[event.id]?.title ?? event.title)} was cancelled`,
      when: when(event, timeZone),
      start: event.start,
    });
  }
  for (const [id, before] of Object.entries(memory?.seen ?? {})) {
    const after = current.get(id);
    if (after) {
      if (after.start !== before.start || after.end !== before.end)
        found.push({
          key: `moved:${id}:${after.start}`,
          kind: "moved",
          text: `${quote(after.title)} moved from ${when({ ...before, allDay: after.allDay }, timeZone)}`,
          when: when(after, timeZone),
          start: after.start,
          url: after.url,
        });
      continue;
    }
    // Gone without a cancellation record: only trust it inside the window that was read.
    if (at(before.start) <= now || at(before.start) >= horizon) continue;
    if (events.some((event) => event.id === id)) continue;
    found.push({
      key: `cancelled:${id}`,
      kind: "cancelled",
      text: `${quote(before.title)} was cancelled or removed`,
      when: when({ ...before, allDay: !before.start.includes("T") }, timeZone),
      start: before.start,
    });
  }
  return found;
}

function cron(time: number, timeZone: string) {
  const parts = Object.fromEntries(
    format(timeZone, { minute: "numeric", hour: "numeric", hourCycle: "h23", day: "numeric", month: "numeric" })
      .formatToParts(time)
      .map((part) => [part.type, part.value]),
  );
  return `${Number(parts.minute)} ${Number(parts.hour)} ${parts.day} ${parts.month} *`;
}

/** It picks its own next check: shortly before the next meeting, or in two hours. */
export function planNextCheck(events: ScanEvent[], now: Date, timeZone: string): NextCheck {
  const soonest = now.getTime() + 5 * minute;
  const latest = now.getTime() + 120 * minute;
  const next = events
    .filter((event) => attending(event, now.getTime()))
    .sort((a, b) => at(a.start) - at(b.start))
    .find((event) => at(event.start) - 15 * minute >= soonest);
  const beforeMeeting = next && at(next.start) - 15 * minute <= latest;
  const time = beforeMeeting ? at(next.start) - 15 * minute : latest;
  const sameDay = localDate(time, timeZone) === localDate(now.getTime(), timeZone);
  return {
    at: new Date(time).toISOString(),
    label: sameDay
      ? timeLabel(time, timeZone)
      : `${format(timeZone, { weekday: "short" }).format(time)} ${timeLabel(time, timeZone)}`,
    reason: beforeMeeting ? `15 minutes before ${quote(next.title)}` : "to catch any changes",
    cron: cron(time, timeZone),
  };
}

function compose(fresh: CalendarCallout[], first: boolean, next: NextCheck | undefined) {
  const count = fresh.length;
  const heading = first
    ? `${count} ${count === 1 ? "thing" : "things"} on your calendar ${count === 1 ? "needs" : "need"} a look:`
    : `Since my last check, ${count} ${count === 1 ? "thing changed" : "things changed"}:`;
  const lines = fresh
    .slice(0, messageItems)
    .map((callout) => `- **${calloutLabels[callout.kind]}** · ${callout.text} · ${callout.when}`);
  if (count > messageItems) lines.push(`- …and ${count - messageItems} more in this run.`);
  const footer = next
    ? `I’ll check again at ${next.label}, ${next.reason}.`
    : "That was my last check.";
  return `${heading}\n\n${lines.join("\n")}\n\n${footer}`;
}

function allClear(next: NextCheck | undefined) {
  const footer = next
    ? `I’ll keep watching and check again at ${next.label}, ${next.reason}.`
    : "That was my only check.";
  return `Your next 7 days look clear: no clashes, cancellations, declines, or replies you owe.\n\n${footer}`;
}

/** Reviews one calendar read against what the watch has already seen and sent. */
export function reviewCalendar(input: {
  events: ScanEvent[];
  now: Date;
  timeZone: string;
  windowEnd: Date;
  truncated: boolean;
  memory?: WatchMemory;
  lastCheck: boolean;
}): CalendarReview {
  const now = input.now.getTime();
  const live = input.events.filter((event) => !event.cancelled && !event.marker);
  // A truncated read says nothing about events past the last one returned.
  const horizon = input.truncated
    ? Math.max(now, ...live.map((event) => at(event.start)))
    : input.windowEnd.getTime();
  const all = [
    ...changes(input.events, input.memory, now, horizon, input.timeZone),
    ...conflicts(input.events, now, input.timeZone),
    ...people(input.events, now, input.timeZone),
    ...backToBack(input.events, now, input.timeZone),
  ];
  const unique = [...new Map(all.map((callout) => [callout.key, callout])).values()].sort(
    (a, b) => at(a.start) - at(b.start),
  );
  const sent = new Set(input.memory?.sent ?? []);
  const callouts = unique.map((callout) => ({ ...callout, fresh: !sent.has(callout.key) }));
  const fresh = callouts.filter((callout) => callout.fresh);
  const nextCheck = planNextCheck(input.events, input.now, input.timeZone);
  const seen: WatchMemory["seen"] = {};
  for (const event of live.filter((item) => at(item.end) > now).slice(0, 100))
    seen[event.id] = { title: event.title, start: event.start, end: event.end };
  return {
    callouts,
    message: fresh.length
      ? compose(fresh, !input.memory, input.lastCheck ? undefined : nextCheck)
      : input.memory
        ? undefined
        : allClear(input.lastCheck ? undefined : nextCheck),
    nextCheck,
    memory: { seen, sent: [...sent, ...fresh.map((callout) => callout.key)].slice(-300) },
    events: live.length,
  };
}
