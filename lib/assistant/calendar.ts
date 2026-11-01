import {
  ConnectError,
  ConnectorInstallationRequiredError,
  NoValidTokenError,
  UserAuthorizationRequiredError,
  deleteTokenCacheEntry,
  getToken,
  startAuthorization,
} from "@vercel/connect";
import type { ConnectTokenParams } from "@vercel/connect";
import { createHash } from "node:crypto";
import { z } from "zod";
import { calendarEventDraftSchema, validateCalendarEventDraft } from "./calendar-event-schema";
import type { CalendarEventDraft } from "./calendar-event-schema";
import type { ScanEvent } from "./calendar-callouts";
import type { AssistantActor } from "@/lib/auth/actor";
import { parseAssistantActor } from "@/lib/auth/actor";

export { calendarEventDraftSchema, validateCalendarEventDraft } from "./calendar-event-schema";
export type { CalendarEventDraft } from "./calendar-event-schema";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
export const CALENDAR_READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const CALENDAR_OWNED_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const zonedTimestampSchema = z.iso.datetime({ offset: true });

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  timeZone?: string;
  location?: string;
  htmlUrl?: string;
}

export interface CalendarStatus {
  state: "connected" | "not_configured" | "authorization_required" | "unavailable";
  provider: "google";
  message: string;
  canAuthorize: boolean;
  writeEnabled: boolean;
  capabilities: { read: boolean; createEvent: boolean; deleteManagedEvent: boolean };
  ownerEmail?: string;
  calendarName?: string;
  timeZone?: string;
}

export interface ManagedCalendarEvent extends CalendarEvent {
  managed: true;
  reused: boolean;
}

export interface CalendarQuery {
  timeMin?: string;
  timeMax?: string;
  limit?: number;
}

export interface CalendarEventsResult {
  events: CalendarEvent[];
  calendarName: string;
  timeZone: string;
  truncated: boolean;
}

export interface CalendarScan {
  events: ScanEvent[];
  timeZone: string;
  timeMin: string;
  timeMax: string;
  truncated: boolean;
}

export interface CalendarAvailabilityQuery {
  timeMin: string;
  timeMax: string;
  durationMinutes: number;
  timeZone?: string;
}

type CalendarErrorCode =
  | "not_configured"
  | "authorization_required"
  | "permission_denied"
  | "unavailable"
  | "invalid_query"
  | "invalid_draft"
  | "write_disabled"
  | "primary_only"
  | "owner_mismatch"
  | "conflict"
  | "not_managed";

export class CalendarIntegrationError extends Error {
  constructor(
    public readonly code: CalendarErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CalendarIntegrationError";
  }
}

export interface CalendarEnvironment {
  ASSISTANT_GOOGLE_CONNECTOR?: string;
  ASSISTANT_GOOGLE_SUBJECT_ID?: string;
  ASSISTANT_CALENDAR_ID?: string;
  ASSISTANT_CALENDAR_WRITE_ENABLED?: string;
  ASSISTANT_CALENDAR_OWNER_EMAIL?: string;
}

interface CalendarDependencies {
  environment?: () => CalendarEnvironment;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  getToken?: typeof getToken;
  startAuthorization?: typeof startAuthorization;
  deleteTokenCacheEntry?: typeof deleteTokenCacheEntry;
  now?: () => Date;
}

const eventTimeSchema = z.object({
  dateTime: z.string().optional(),
  date: z.string().optional(),
  timeZone: z.string().optional(),
});
const eventsResponseSchema = z.object({
  summary: z.string().optional(),
  timeZone: z.string(),
  nextPageToken: z.string().optional(),
  items: z.array(z.object({
    id: z.string(),
    summary: z.string().optional(),
    status: z.string().optional(),
    start: eventTimeSchema.optional(),
    end: eventTimeSchema.optional(),
    location: z.string().optional(),
    htmlLink: z.string().optional(),
  })).default([]),
});
const responseStatusSchema = z.enum(["needsAction", "declined", "tentative", "accepted"]).catch("needsAction");
const scanResponseSchema = z.object({
  timeZone: z.string(),
  nextPageToken: z.string().optional(),
  items: z.array(z.object({
    id: z.string(),
    summary: z.string().optional(),
    status: z.string().optional(),
    start: eventTimeSchema.optional(),
    end: eventTimeSchema.optional(),
    originalStartTime: eventTimeSchema.optional(),
    updated: z.string().optional(),
    transparency: z.string().optional(),
    eventType: z.string().optional(),
    htmlLink: z.string().optional(),
    organizer: z.object({self: z.boolean().optional()}).optional(),
    attendees: z.array(z.object({
      email: z.string().optional(),
      displayName: z.string().optional(),
      responseStatus: responseStatusSchema.optional(),
      self: z.boolean().optional(),
      resource: z.boolean().optional(),
    })).optional(),
  })).default([]),
});
const busyResponseSchema = z.object({
  calendars: z.record(z.string(), z.object({
    errors: z.array(z.unknown()).optional(),
    busy: z.array(z.object({start: z.string(), end: z.string()})),
  })),
});

const managedEventResponseSchema = z.object({
  id: z.string(), summary: z.string(), description: z.string().optional(),
  status: z.string().optional(), etag: z.string().optional(),
  start: z.object({dateTime: z.iso.datetime({offset: true}), timeZone: z.string().optional()}),
  end: z.object({dateTime: z.iso.datetime({offset: true}), timeZone: z.string().optional()}),
  htmlLink: z.string().optional(), attendees: z.array(z.unknown()).optional(), conferenceData: z.unknown().optional(),
  hangoutLink: z.string().optional(), visibility: z.string().optional(),
  reminders: z.object({useDefault: z.boolean(), overrides: z.array(z.unknown()).optional()}).optional(),
  recurrence: z.array(z.string()).optional(), recurringEventId: z.string().optional(), originalStartTime: z.unknown().optional(),
  extendedProperties: z.object({private: z.record(z.string(), z.string()).optional()}).optional(),
});
type ManagedProviderEvent = z.infer<typeof managedEventResponseSchema>;

function runtimeCalendarEnvironment(): CalendarEnvironment {
  return {
    ASSISTANT_GOOGLE_CONNECTOR: process.env.ASSISTANT_GOOGLE_CONNECTOR,
    ASSISTANT_GOOGLE_SUBJECT_ID: process.env.ASSISTANT_GOOGLE_SUBJECT_ID,
    ASSISTANT_CALENDAR_ID: process.env.ASSISTANT_CALENDAR_ID,
    ASSISTANT_CALENDAR_WRITE_ENABLED: process.env.ASSISTANT_CALENDAR_WRITE_ENABLED,
    ASSISTANT_CALENDAR_OWNER_EMAIL: process.env.ASSISTANT_CALENDAR_OWNER_EMAIL,
  };
}

export function calendarWriteEnabled(environment: CalendarEnvironment = runtimeCalendarEnvironment()): boolean {
  return environment.ASSISTANT_CALENDAR_WRITE_ENABLED === "true";
}

function capabilities(connected: boolean, writeEnabled: boolean, calendarId = "primary") {
  const canWrite = connected && writeEnabled && calendarId === "primary";
  return {read: connected, createEvent: canWrite, deleteManagedEvent: canWrite};
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function managedCalendarEventId(actionId: string, environment: CalendarEnvironment = runtimeCalendarEnvironment()): string {
  const subject = environment.ASSISTANT_GOOGLE_SUBJECT_ID?.trim();
  if (!subject || !/^[A-Za-z0-9:_-]{8,200}$/.test(actionId))
    throw new CalendarIntegrationError("invalid_draft", "A configured owner and valid durable action ID are required for this calendar write.");
  return sha256(`assistant-calendar-event:${sha256(`assistant-calendar-owner:${subject}`)}:${actionId}`);
}

function draftHash(draft: CalendarEventDraft): string {
  return sha256(JSON.stringify({summary: draft.summary, description: draft.description || "", start: new Date(draft.start).toISOString(), end: new Date(draft.end).toISOString(), timeZone: draft.timeZone}));
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function timestamp(value: string): number {
  // Explicit offsets avoid silently interpreting a model's dates in the server zone.
  if (!zonedTimestampSchema.safeParse(value).success) return NaN;
  return Date.parse(value);
}

function validateWindow(timeMin: string, timeMax: string) {
  const start = timestamp(timeMin);
  const end = timestamp(timeMax);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > MAX_WINDOW_MS)
    throw new CalendarIntegrationError("invalid_query", "Choose a valid calendar window of at most 31 days, including time zone offsets.");
  return { start, end };
}

function safeCalendarUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "calendar.google.com" || url.hostname === "www.google.com")
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function safeError(error: unknown): CalendarIntegrationError {
  if (error instanceof CalendarIntegrationError) return error;
  if (error instanceof UserAuthorizationRequiredError || error instanceof NoValidTokenError || error instanceof ConnectorInstallationRequiredError)
    return new CalendarIntegrationError("authorization_required", "Authorize Google Calendar for the assistant's configured calendar access.");
  if (error instanceof ConnectError && (error.code === "user_authorization_required" || error.code === "no_token"))
    return new CalendarIntegrationError("authorization_required", "Authorize Google Calendar for the assistant's configured calendar access.");
  return new CalendarIntegrationError("unavailable", "Calendar is unavailable. Check the Vercel project connection, development OIDC token, and Google permissions, then retry.");
}

export function calendarErrorStatus(error: unknown, writeEnabled = calendarWriteEnabled()): CalendarStatus {
  const failure = safeError(error);
  return {
    state: failure.code === "not_configured" ? "not_configured" : ["authorization_required", "owner_mismatch"].includes(failure.code) ? "authorization_required" : "unavailable",
    provider: "google",
    message: failure.message,
    canAuthorize: ["authorization_required", "owner_mismatch"].includes(failure.code),
    writeEnabled,
    capabilities: capabilities(false, writeEnabled),
  };
}

/** Server-only provider boundary. It never returns an OAuth credential or raw provider error. */
export function createCalendarClient(dependencies: CalendarDependencies = {}) {
  const environment = dependencies.environment ?? runtimeCalendarEnvironment;
  const requestFetch = dependencies.fetch ?? fetch;
  const tokenFor = dependencies.getToken ?? getToken;
  const authorize = dependencies.startAuthorization ?? startAuthorization;
  const evictToken = dependencies.deleteTokenCacheEntry ?? deleteTokenCacheEntry;
  const now = dependencies.now ?? (() => new Date());

  function configuration() {
    const env = environment();
    const connector = env.ASSISTANT_GOOGLE_CONNECTOR?.trim();
    const subjectId = env.ASSISTANT_GOOGLE_SUBJECT_ID?.trim();
    const ownerEmail = env.ASSISTANT_CALENDAR_OWNER_EMAIL?.trim();
    const missing = [!connector && "ASSISTANT_GOOGLE_CONNECTOR", !subjectId && "ASSISTANT_GOOGLE_SUBJECT_ID", calendarWriteEnabled(env) && !ownerEmail && "ASSISTANT_CALENDAR_OWNER_EMAIL"].filter(Boolean);
    if (missing.length)
      throw new CalendarIntegrationError("not_configured", `Set ${missing.join(" and ")} to connect Google Calendar through Vercel Connect.`);
    if (ownerEmail && !z.email().safeParse(ownerEmail).success)
      throw new CalendarIntegrationError("not_configured", "Set ASSISTANT_CALENDAR_OWNER_EMAIL to the intended account's valid primary calendar email.");
    const params: ConnectTokenParams = {
      subject: { type: "user", id: subjectId! },
      scopes: calendarWriteEnabled(env) ? [CALENDAR_READ_SCOPE, CALENDAR_OWNED_EVENTS_SCOPE] : [CALENDAR_READ_SCOPE],
    };
    return { connector: connector!, params, calendarId: env.ASSISTANT_CALENDAR_ID?.trim() || "primary" };
  }

  async function googleResponse(path: string, init?: RequestInit, allowedStatuses: number[] = []): Promise<Response> {
    const { connector, params } = configuration();
    try {
      const token = await tokenFor(connector, params);
      const response = await requestFetch(`${CALENDAR_API}${path}`, {
        ...init,
        headers: { ...init?.headers, Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 401) {
        evictToken(connector, params);
        throw new CalendarIntegrationError("authorization_required", "Google Calendar authorization expired or was revoked. Reconnect your calendar.");
      }
      if (response.status === 403)
        throw new CalendarIntegrationError("permission_denied", "Google Calendar denied access. Enable the Calendar API and grant the configured calendar scopes to this connector.");
      if (!response.ok && !allowedStatuses.includes(response.status))
        throw new CalendarIntegrationError("unavailable", response.status === 429 ? "Google Calendar is rate limited. Try again shortly." : "Google Calendar could not complete this request. Try again.");
      return response;
    } catch (error) {
      throw safeError(error);
    }
  }

  async function googleRequest(path: string, init?: RequestInit): Promise<unknown> {
    try { return await (await googleResponse(path, init)).json(); }
    catch (error) { throw safeError(error); }
  }

  async function verifyConfiguredOwner(): Promise<string | undefined> {
    const expected = environment().ASSISTANT_CALENDAR_OWNER_EMAIL?.trim().toLowerCase();
    if (!expected) return undefined;
    const raw = await googleRequest("/calendars/primary?fields=id");
    const parsed = z.object({id: z.email()}).safeParse(raw);
    if (!parsed.success || parsed.data.id.toLowerCase() !== expected)
      throw new CalendarIntegrationError("owner_mismatch", "The connected Google account does not match the server-configured calendar owner. Reconnect using the intended account; no events were read or changed.");
    return parsed.data.id;
  }

  function writeConfiguration(actionId: string) {
    const env = environment();
    if (!calendarWriteEnabled(env))
      throw new CalendarIntegrationError("write_disabled", "Calendar writes are disabled. The server owner must explicitly enable ASSISTANT_CALENDAR_WRITE_ENABLED before proposing a write.");
    const config = configuration();
    if (config.calendarId !== "primary")
      throw new CalendarIntegrationError("primary_only", "This demo can write only to the configured owner's primary calendar.");
    const eventId = managedCalendarEventId(actionId, env);
    const owner = sha256(`assistant-calendar-owner:${env.ASSISTANT_GOOGLE_SUBJECT_ID!.trim()}`);
    return {...config, owner, eventId};
  }

  function parseManagedEvent(raw: unknown): ManagedProviderEvent {
    const parsed = managedEventResponseSchema.safeParse(raw);
    if (!parsed.success)
      throw new CalendarIntegrationError("unavailable", "Google Calendar returned an unexpected managed-event response. No write outcome was inferred.");
    return parsed.data;
  }

  function verifyManagedEvent(event: ManagedProviderEvent, eventId: string, owner: string, expectedHash?: string) {
    const marker = event.extendedProperties?.private;
    if (event.id !== eventId || marker?.assistantManaged !== "v1" || marker.assistantOwner !== owner || !/^[a-f0-9]{64}$/.test(marker.assistantPayload ?? ""))
      throw new CalendarIntegrationError("not_managed", "This event was not created by this assistant for the configured owner. It cannot be reused or deleted.");
    if (event.attendees?.length || event.conferenceData || event.hangoutLink || event.recurrence?.length || event.recurringEventId || event.originalStartTime
      || event.visibility !== "private" || event.reminders?.useDefault !== false || event.reminders.overrides?.length)
      throw new CalendarIntegrationError("conflict", "This managed event's privacy, reminders, recurrence, attendees, or conference settings changed. No action was taken.");
    if (expectedHash) {
      const actual = calendarEventDraftSchema.safeParse({summary: event.summary, description: event.description, start: event.start.dateTime, end: event.end.dateTime, timeZone: event.start.timeZone});
      if (marker.assistantPayload !== expectedHash || !actual.success || draftHash(actual.data) !== expectedHash || event.status === "cancelled")
        throw new CalendarIntegrationError("conflict", "This action ID already belongs to a different, changed, or deleted calendar event. No duplicate was created.");
    }
  }

  function managedResult(event: ManagedProviderEvent, reused: boolean): ManagedCalendarEvent {
    return {id: event.id, title: event.summary, start: event.start.dateTime, end: event.end.dateTime, allDay: false, timeZone: event.start.timeZone, htmlUrl: safeCalendarUrl(event.htmlLink), managed: true, reused};
  }

  /** Called only by an approved durable Workflow step; never exposed as a model tool. */
  async function createManagedEvent(raw: CalendarEventDraft, actionId: string): Promise<ManagedCalendarEvent> {
    const {owner, eventId} = writeConfiguration(actionId);
    let draft: CalendarEventDraft;
    try { draft = validateCalendarEventDraft(raw, now()); }
    catch { throw new CalendarIntegrationError("invalid_draft", "Invalid calendar event. Use a bounded title, optional description, explicit time zone, and a future start within 365 days; duration must be 5–480 minutes. Attendees and other extra fields are not allowed."); }
    await verifyConfiguredOwner();
    const payloadHash = draftHash(draft);
    const path = `/calendars/primary/events/${eventId}`;
    const response = await googleResponse("/calendars/primary/events?sendUpdates=none&conferenceDataVersion=0", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        id: eventId, summary: draft.summary,
        ...(draft.description ? {description: draft.description} : {}),
        start: {dateTime: draft.start, timeZone: draft.timeZone},
        end: {dateTime: draft.end, timeZone: draft.timeZone},
        extendedProperties: {private: {assistantManaged: "v1", assistantOwner: owner, assistantPayload: payloadHash}},
        visibility: "private", reminders: {useDefault: false},
        guestsCanModify: false, guestsCanInviteOthers: false, guestsCanSeeOtherGuests: false,
      }),
    }, [409]);
    if (response.status !== 409)
      verifyManagedEvent(parseManagedEvent(await response.json()), eventId, owner, payloadHash);
    // The exact GET verifies persisted state, including a POST that succeeded before retry.
    const persisted = parseManagedEvent(await googleRequest(path));
    verifyManagedEvent(persisted, eventId, owner, payloadHash);
    return managedResult(persisted, response.status === 409);
  }

  /** Explicit cleanup only; action-derived IDs and owner markers prevent arbitrary deletion. */
  async function deleteManagedEvent(actionId: string): Promise<{id: string; deleted: true; alreadyAbsent: boolean}> {
    const {owner, eventId} = writeConfiguration(actionId);
    await verifyConfiguredOwner();
    const path = `/calendars/primary/events/${eventId}`;
    const current = await googleResponse(path, undefined, [404, 410]);
    if (current.status === 404 || current.status === 410)
      return {id: eventId, deleted: true, alreadyAbsent: true};
    const event = parseManagedEvent(await current.json());
    verifyManagedEvent(event, eventId, owner, event.extendedProperties?.private?.assistantPayload);
    if (!event.etag)
      throw new CalendarIntegrationError("unavailable", "Google Calendar did not provide an event version. No deletion was attempted.");
    const deleted = await googleResponse(`${path}?sendUpdates=none`, {method: "DELETE", headers: {"If-Match": event.etag}}, [404, 410]);
    return {id: eventId, deleted: true, alreadyAbsent: deleted.status === 404 || deleted.status === 410};
  }

  async function listEvents(query: CalendarQuery = {}): Promise<CalendarEventsResult> {
    const instant = now();
    const timeMin = query.timeMin ?? instant.toISOString();
    const parsedStart = timestamp(timeMin);
    if (!Number.isFinite(parsedStart))
      throw new CalendarIntegrationError("invalid_query", "Choose a valid calendar start time, including its time zone offset.");
    const timeMax = query.timeMax ?? new Date(parsedStart + 7 * 24 * 60 * 60 * 1000).toISOString();
    validateWindow(timeMin, timeMax);
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new CalendarIntegrationError("invalid_query", "Request between 1 and 50 calendar events.");
    const { calendarId } = configuration();
    await verifyConfiguredOwner();
    const params = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: String(limit), showDeleted: "false", fields: "summary,timeZone,nextPageToken,items(id,summary,status,start,end,location,htmlLink)" });
    const raw = await googleRequest(`/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    const parsed = eventsResponseSchema.safeParse(raw);
    if (!parsed.success)
      throw new CalendarIntegrationError("unavailable", "Google Calendar returned an unexpected response. Try again.");
    const data = parsed.data;
    const events: CalendarEvent[] = [];
    for (const event of data.items) {
      if (event.status === "cancelled" || !event.start || !event.end) continue;
      const start = event.start.dateTime ?? event.start.date;
      const end = event.end.dateTime ?? event.end.date;
      if (!start || !end) continue;
      events.push({
        id: event.id,
        title: event.summary?.trim().slice(0, 1000) || "Untitled event",
        start,
        end,
        allDay: !event.start.dateTime,
        timeZone: event.start.timeZone ?? data.timeZone,
        location: event.location?.slice(0, 1000),
        htmlUrl: safeCalendarUrl(event.htmlLink),
      });
    }
    return { events, calendarName: data.summary?.slice(0, 200) || "Google Calendar", timeZone: data.timeZone && validTimeZone(data.timeZone) ? data.timeZone : "UTC", truncated: Boolean(data.nextPageToken) };
  }

  /**
   * The always-on watch's read: the next seven days, including cancellations
   * and guest replies. Guests keep only a first name and an email hash.
   */
  async function scanEvents(days = 7): Promise<CalendarScan> {
    const instant = now();
    const timeMin = instant.toISOString();
    const timeMax = new Date(instant.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
    validateWindow(timeMin, timeMax);
    const { calendarId } = configuration();
    await verifyConfiguredOwner();
    const params = new URLSearchParams({
      timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "100", showDeleted: "true",
      fields: "timeZone,nextPageToken,items(id,summary,status,start,end,originalStartTime,updated,transparency,eventType,htmlLink,organizer(self),attendees(email,displayName,responseStatus,self,resource))",
    });
    const raw = await googleRequest(`/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    const parsed = scanResponseSchema.safeParse(raw);
    if (!parsed.success)
      throw new CalendarIntegrationError("unavailable", "Google Calendar returned an unexpected response. Try again.");
    const events: ScanEvent[] = [];
    for (const item of parsed.data.items) {
      const startTime = item.start ?? item.originalStartTime;
      const start = startTime?.dateTime ?? startTime?.date;
      if (!start) continue;
      const end = item.end?.dateTime ?? item.end?.date ?? start;
      const self = item.attendees?.find((attendee) => attendee.self);
      events.push({
        id: item.id,
        title: item.summary?.trim().slice(0, 200) || "Untitled event",
        start,
        end,
        allDay: !startTime?.dateTime,
        cancelled: item.status === "cancelled",
        updated: item.updated,
        free: item.transparency === "transparent",
        marker: ["workingLocation", "birthday"].includes(item.eventType ?? ""),
        organizedByYou: item.organizer?.self === true,
        yourResponse: self?.responseStatus,
        guests: (item.attendees ?? [])
          .filter((attendee) => !attendee.self && !attendee.resource && attendee.email)
          .map((attendee) => ({
            key: sha256(attendee.email!.toLowerCase()).slice(0, 12),
            name: attendee.displayName?.trim().split(/\s+/)[0]?.slice(0, 60) || attendee.email!.split("@")[0].slice(0, 60),
            response: attendee.responseStatus ?? "needsAction",
          })),
        url: safeCalendarUrl(item.htmlLink),
      });
    }
    const timeZone = validTimeZone(parsed.data.timeZone) ? parsed.data.timeZone : "UTC";
    return { events, timeZone, timeMin, timeMax, truncated: Boolean(parsed.data.nextPageToken) };
  }

  async function availability(query: CalendarAvailabilityQuery) {
    const { start, end } = validateWindow(query.timeMin, query.timeMax);
    if (!Number.isInteger(query.durationMinutes) || query.durationMinutes < 5 || query.durationMinutes > 480)
      throw new CalendarIntegrationError("invalid_query", "Choose a duration between 5 and 480 minutes.");
    const timeZone = query.timeZone ?? "UTC";
    if (!validTimeZone(timeZone))
      throw new CalendarIntegrationError("invalid_query", "Choose a valid IANA time zone, such as America/Toronto.");
    const { calendarId } = configuration();
    await verifyConfiguredOwner();
    const raw = await googleRequest("/freeBusy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeMin: query.timeMin, timeMax: query.timeMax, timeZone, items: [{ id: calendarId }] }),
    });
    const parsed = busyResponseSchema.safeParse(raw);
    const calendar = parsed.success ? parsed.data.calendars[calendarId] : undefined;
    if (!calendar || calendar.errors?.length)
      throw new CalendarIntegrationError("unavailable", "Availability could not be verified for this calendar. No free slots were inferred.");
    const busy: Array<{start: number; end: number}> = [];
    for (const period of calendar.busy) {
      const busyStart = timestamp(period.start);
      const busyEnd = timestamp(period.end);
      if (!Number.isFinite(busyStart) || !Number.isFinite(busyEnd) || busyEnd <= busyStart)
        throw new CalendarIntegrationError("unavailable", "Google Calendar returned invalid availability. No free slots were inferred.");
      if (busyEnd > start && busyStart < end) busy.push({start: Math.max(start, busyStart), end: Math.min(end, busyEnd)});
    }
    busy.sort((a, b) => a.start - b.start);
    const durationMs = query.durationMinutes * 60_000;
    const slots: Array<{ start: string; end: string }> = [];
    let cursor = start;
    for (const block of [...busy, { start: end, end }]) {
      if (block.start - cursor >= durationMs)
        slots.push({start: new Date(cursor).toISOString(), end: new Date(cursor + durationMs).toISOString()});
      cursor = Math.max(cursor, block.end);
    }
    return { slots: slots.slice(0, 12), timeZone };
  }

  async function overview(query: CalendarQuery = {}) {
    try {
      const result = await listEvents(query);
      const writeEnabled = calendarWriteEnabled(environment());
      const status: CalendarStatus = {state: "connected", provider: "google", message: writeEnabled ? "Connected for calendar reads and owner-approved event creation. Each write requires exact proposal approval in the task inbox." : "Connected with read-only access. Your calendar stays unchanged.", canAuthorize: true, writeEnabled, capabilities: capabilities(true, writeEnabled, environment().ASSISTANT_CALENDAR_ID?.trim() || "primary"), ownerEmail: environment().ASSISTANT_CALENDAR_OWNER_EMAIL?.trim(), calendarName: result.calendarName, timeZone: result.timeZone};
      return {status, ...result};
    } catch (error) {
      return {status: calendarErrorStatus(error, calendarWriteEnabled(environment())), events: [] as CalendarEvent[], truncated: false};
    }
  }

  async function authorizationUrl(callbackUrl: string): Promise<string> {
    const { connector, params } = configuration();
    try {
      const result = await authorize(connector, params, { callbackUrl });
      const url = new URL(result.url);
      if (url.protocol !== "https:") throw new Error("Invalid authorization URL");
      // The SDK owns OAuth state, PKCE, credential exchange, and the return URL.
      // Only its consent URL crosses the HTTP boundary; never verifier/request/token.
      return url.href;
    } catch (error) {
      throw safeError(error);
    }
  }

  return { listEvents, scanEvents, availability, overview, authorizationUrl, createManagedEvent, deleteManagedEvent };
}

function calendarActor(actor: AssistantActor): AssistantActor {
  const parsed = parseAssistantActor(actor);
  if (!parsed)
    throw new CalendarIntegrationError("not_configured", "A verified Google sign-in is required for calendar access.");
  return {...parsed, email: parsed.email.toLowerCase()};
}

/** Identity comes only from the server session or a persisted, trusted Workflow owner. */
export function createCalendarClientForActor(actor: AssistantActor, dependencies: CalendarDependencies = {}) {
  const boundActor = calendarActor(actor);
  const baseEnvironment = dependencies.environment ?? runtimeCalendarEnvironment;
  return createCalendarClient({...dependencies, environment: () => ({
    ...baseEnvironment(),
    ASSISTANT_GOOGLE_SUBJECT_ID: boundActor.id,
    ASSISTANT_CALENDAR_OWNER_EMAIL: boundActor.email,
    ASSISTANT_CALENDAR_ID: "primary",
  })});
}

export function managedCalendarEventIdForActor(actor: AssistantActor, actionId: string): string {
  const boundActor = calendarActor(actor);
  return managedCalendarEventId(actionId, {ASSISTANT_GOOGLE_SUBJECT_ID: boundActor.id});
}

export function listCalendarEvents(actor: AssistantActor, query: CalendarQuery = {}) {
  return createCalendarClientForActor(actor).listEvents(query);
}
export function scanCalendarEvents(actor: AssistantActor) {
  return createCalendarClientForActor(actor).scanEvents();
}
export function findCalendarAvailability(actor: AssistantActor, query: CalendarAvailabilityQuery) {
  return createCalendarClientForActor(actor).availability(query);
}
export function getCalendarOverview(actor: AssistantActor) {
  return createCalendarClientForActor(actor).overview();
}
export function createCalendarAuthorizationUrl(actor: AssistantActor, callbackUrl: string) {
  return createCalendarClientForActor(actor).authorizationUrl(callbackUrl);
}
export function createManagedCalendarEvent(actor: AssistantActor, draft: CalendarEventDraft, actionId: string) {
  return createCalendarClientForActor(actor).createManagedEvent(draft, actionId);
}
export function deleteManagedCalendarEvent(actor: AssistantActor, actionId: string) {
  return createCalendarClientForActor(actor).deleteManagedEvent(actionId);
}
export async function getCalendarStatus(actor: AssistantActor): Promise<CalendarStatus> {
  return (await createCalendarClientForActor(actor).overview({limit: 1})).status;
}
