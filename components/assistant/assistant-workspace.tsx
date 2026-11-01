"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  CalendarPlusIcon,
  CheckIcon,
  ChevronRightIcon,
  FlaskConicalIcon,
  GlobeIcon,
  InboxIcon,
  LogOutIcon,
  LoaderCircleIcon,
  PlusIcon,
} from "lucide-react";
import { AlwaysOnStory } from "@/components/assistant/always-on-story";
import { AssistantChat } from "@/components/assistant/assistant-chat";
import { BrowserView } from "@/components/assistant/browser-view";
import { CalendarEventComposer } from "@/components/assistant/calendar-event-composer";
import { CalendarWatchStart } from "@/components/assistant/calendar-watch";
import { ChatSplit } from "@/components/assistant/chat-split";
import { RunViewer } from "@/components/assistant/run-viewer";
import { FlowDiagram } from "@/components/assistant/stage-map";
import { taskStatusLabel } from "@/components/assistant/task-detail";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { assistantRequest, errorMessage } from "@/lib/assistant/client";
import { signOut } from "next-auth/react";
import type { AssistantActor } from "@/lib/auth/actor";
import type {
  AssistantDemoStop,
  AssistantMode,
  AssistantTask,
  AssistantPreference,
  TaskAction,
} from "@/lib/assistant/types";
import type { CalendarEvent, CalendarStatus } from "@/lib/assistant/calendar";
import { previewStageMap } from "@/lib/assistant/stage-map";
import {
  beginTaskControl,
  settleTaskControl,
  taskControlView,
} from "@/lib/assistant/task-controls";
import type { TaskControlRequests } from "@/lib/assistant/task-controls";
import { taskExecutionSettings } from "@/lib/assistant/task-form";
import { cn } from "@/lib/utils";
import {
  beginTaskRestart,
  settleTaskRestart,
  taskRestartNotice,
  type TaskRestartRequests,
  type TaskRestartResult,
} from "@/lib/assistant/restart-controls";

interface CalendarData {
  status: CalendarStatus;
  events: CalendarEvent[];
  truncated?: boolean;
}
type AssistantView = "assistant" | "run" | "story" | "inbox" | "connections";
const isAssistantView = (value: unknown): value is AssistantView =>
  value === "assistant" ||
  value === "run" ||
  value === "story" ||
  value === "inbox" ||
  value === "connections";
const terminal = new Set(["completed", "failed", "cancelled"]);

function TaskRow({
  task,
  onOpen,
}: {
  task: AssistantTask;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      className="group flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={() => onOpen(task.runId)}
    >
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm border bg-background">
        {task.status === "completed" ? (
          <CheckIcon className="size-3.5" aria-hidden="true" />
        ) : (
          <InboxIcon
            className="size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">{task.title}</span>
        <span className="text-xs text-muted-foreground">
          {taskStatusLabel(task)} ·{" "}
          {task.mode === "rehearsal" ? "Synthetic" : "Calendar"}
        </span>
      </span>
      <ChevronRightIcon
        className="mt-1.5 size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </button>
  );
}

const demoRequest = "Prepare me for tomorrow’s product design review.";

export function AssistantWorkspace({
  actor,
  initialView = "assistant",
  authorizationDenied = false,
}: {
  actor: AssistantActor;
  initialView?: AssistantView;
  authorizationDenied?: boolean;
}) {
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const view = isAssistantView(requestedView) ? requestedView : initialView;
  // The calendar connection now lives under Always-on; old links still land there.
  const tab = view === "connections" ? "story" : view;
  // The run ID is not a credential; the server checks ownership on every read.
  const selectedId = searchParams.get("run") ?? undefined;
  const [tasks, setTasks] = useState<AssistantTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [signOutError, setSignOutError] = useState<string>();
  const [signingOut, setSigningOut] = useState(false);
  const [selectedTask, setSelectedTask] = useState<AssistantTask>();
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [selectedError, setSelectedError] = useState<string>();
  const [selectedRevision, setSelectedRevision] = useState(0);
  const [selectedStepId, setSelectedStepId] = useState<string>();
  const [openCount, setOpenCount] = useState(0);
  const [offline, setOffline] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number>();
  const [pending, setPending] = useState(false);
  const [controlRequests, setControlRequests] = useState<TaskControlRequests>(
    {},
  );
  const controlRequestsRef = useRef<TaskControlRequests>({});
  const [restartRequests, setRestartRequests] = useState<TaskRestartRequests>({});
  const restartRequestsRef = useRef<TaskRestartRequests>({});
  const createInFlight = useRef(false);
  const [demoStarting, setDemoStarting] = useState(false);
  const createRequest = useRef<{ body: string; key: string } | undefined>(
    undefined,
  );
  const [actionError, setActionError] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [eventComposerOpen, setEventComposerOpen] = useState(false);
  const [mode, setMode] = useState<AssistantMode>("rehearsal");
  const [demoMode, setDemoMode] = useState(true);
  const [title, setTitle] = useState("Prepare for my next meeting");
  const [prompt, setPrompt] = useState(
    "Prepare a concise meeting brief with source links, and tell me when something important changes.",
  );
  const [manualStart, setManualStart] = useState(true);
  const [approval, setApproval] = useState(true);
  const [delay, setDelay] = useState("15");
  const [preference, setPreference] = useState<AssistantPreference>({
    bulletCount: 3,
    includeLinks: true,
  });
  const [preferenceNotice, setPreferenceNotice] = useState("");
  const [preferencePending, setPreferencePending] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [calendar, setCalendar] = useState<CalendarData>();
  const [calendarError, setCalendarError] = useState<string>();
  const [calendarLoading, setCalendarLoading] = useState(
    initialView === "connections",
  );
  const [storyMode, setStoryMode] = useState<"calendar" | "example">("calendar");
  const [watchStarting, setWatchStarting] = useState(false);
  const [watchError, setWatchError] = useState<string>();
  const [browsing, setBrowsing] = useState(false);
  const [browserOpenRequest, setBrowserOpenRequest] = useState(0);

  useEffect(() => {
    if (initialView !== "connections") return;
    let active = true;
    void assistantRequest<CalendarData>("/api/assistant/calendar")
      .then((data) => {
        if (active) {
          setCalendar(data);
          setCalendarError(undefined);
        }
      })
      .catch((cause) => {
        if (active) setCalendarError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setCalendarLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initialView]);

  useEffect(() => {
    let active = true;
    void assistantRequest<{ preference: AssistantPreference }>(
      "/api/assistant/preferences",
    )
      .then((data) => {
        if (active) setPreference(data.preference);
      })
      .catch(() => {
        /* Inbox access feedback also covers the protected preferences route. */
      });
    return () => {
      active = false;
    };
  }, []);

  async function savePreference(reset = false) {
    setPreferencePending(true);
    setPreferenceNotice("");
    try {
      const data = await assistantRequest<{ preference: AssistantPreference }>(
        "/api/assistant/preferences",
        {
          method: reset ? "DELETE" : "PUT",
          ...(!reset && { body: JSON.stringify(preference) }),
        },
      );
      setPreference(data.preference);
      setPreferenceNotice(
        reset ? "Task defaults reset." : "Task defaults saved.",
      );
    } catch (cause) {
      setPreferenceNotice(errorMessage(cause));
    } finally {
      setPreferencePending(false);
    }
  }

  const refreshTasks = useCallback(async () => {
    try {
      const data = await assistantRequest<{ tasks: AssistantTask[] }>(
        "/api/assistant/tasks",
      );
      setTasks(data.tasks);
      setError(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // A disconnected viewer stops observing; server work is unaffected.
    if (offline) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (document.visibilityState === "visible") await refreshTasks();
      if (active) timer = setTimeout(poll, 2500);
    }
    void poll();
    const visible = () => {
      if (document.visibilityState === "visible") void refreshTasks();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refreshTasks, offline]);

  useEffect(() => {
    if (!selectedId || offline) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refreshSelected() {
      let nextDelay = 2500;
      try {
        const data = await assistantRequest<{ task: AssistantTask }>(
          `/api/assistant/tasks/${encodeURIComponent(selectedId!)}`,
        );
        if (data.task.demo) nextDelay = 500;
        if (active) {
          setSelectedTask(data.task);
          setSelectedError(undefined);
          setSyncedAt(Date.now());
        }
      } catch (cause) {
        if (active) setSelectedError(errorMessage(cause));
      } finally {
        if (active) {
          setSelectedLoading(false);
          timer = setTimeout(refreshSelected, nextDelay);
        }
      }
    }
    void refreshSelected();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [selectedId, selectedRevision, offline]);

  // Always-on and the inbox need the connection status; read it once, on first visit.
  const calendarRequested = useRef(initialView === "connections");
  const loadCalendar = useEffectEvent(() => {
    if (calendarRequested.current || (tab !== "story" && tab !== "inbox")) return;
    calendarRequested.current = true;
    void refreshCalendar();
  });
  useEffect(() => loadCalendar(), [tab]);

  async function connectCalendar() {
    setCalendarError(undefined);
    try {
      const data = await assistantRequest<{ url: string }>(
        "/api/assistant/calendar/authorize",
        { method: "POST", body: "{}" },
      );
      const url = new URL(data.url);
      if (url.protocol !== "https:")
        throw new Error("Authorization requires a secure URL.");
      window.location.assign(url.href);
    } catch (cause) {
      setCalendarError(errorMessage(cause));
    }
  }

  async function startWatch() {
    if (pending || createInFlight.current) return;
    createInFlight.current = true;
    setWatchStarting(true);
    setWatchError(undefined);
    try {
      const data = await assistantRequest<{ runId: string }>(
        "/api/assistant/tasks",
        {
          method: "POST",
          headers: { "x-assistant-idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ kind: "calendar_watch", mode: "calendar" }),
        },
      );
      openTask(data.runId, undefined, "story");
      await refreshTasks();
    } catch (cause) {
      setWatchError(errorMessage(cause));
    } finally {
      createInFlight.current = false;
      setWatchStarting(false);
    }
  }

  async function refreshCalendar() {
    setCalendarLoading(true);
    setCalendarError(undefined);
    try {
      setCalendar(
        await assistantRequest<CalendarData>("/api/assistant/calendar"),
      );
    } catch (cause) {
      setCalendarError(errorMessage(cause));
    } finally {
      setCalendarLoading(false);
    }
  }

  async function createTask(classroomDemo = false) {
    if (pending || createInFlight.current) return;
    createInFlight.current = true;
    setDemoStarting(classroomDemo);
    setPending(true);
    setActionError(undefined);
    try {
      const body = JSON.stringify(classroomDemo ? {
        title: "Classroom walkthrough",
        prompt: demoRequest,
        mode: "rehearsal",
        demoMode: true,
        manualStart: false,
        delaySeconds: 0,
        approvalRequired: true,
        maxChecks: 3,
        preference,
      } : {
        title,
        prompt,
        mode,
        ...taskExecutionSettings(mode, demoMode, {
          delay,
          manualStart,
          approvalRequired: approval,
        }),
        sourceVersion: 1,
        maxChecks: 3,
        preference,
        ...(mode === "rehearsal" && { demoMode }),
      });
      if (createRequest.current?.body !== body)
        createRequest.current = { body, key: crypto.randomUUID() };
      const data = await assistantRequest<{ runId: string }>(
        "/api/assistant/tasks",
        {
          method: "POST",
          headers: { "x-assistant-idempotency-key": createRequest.current.key },
          body,
        },
      );
      openTask(data.runId);
      createRequest.current = undefined;
      setCreateOpen(false);
      await refreshTasks();
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      createInFlight.current = false;
      setDemoStarting(false);
      setPending(false);
    }
  }

  async function restartTask(runId: string, eventId: string) {
    if (pending || Object.values(restartRequestsRef.current).some((request) => request.phase === "submitting")) return;
    const started = beginTaskRestart(restartRequestsRef.current, runId, eventId, () => crypto.randomUUID());
    if (!started) return;
    restartRequestsRef.current = started.requests;
    setRestartRequests(started.requests);
    try {
      const result = await assistantRequest<TaskRestartResult>(
        `/api/assistant/tasks/${encodeURIComponent(runId)}/restart`,
        { method: "POST", body: JSON.stringify({ eventId: started.request.eventId, requestId: started.request.requestId }) },
      );
      restartRequestsRef.current = settleTaskRestart(restartRequestsRef.current, started.request, { phase: "accepted", result });
      setRestartRequests(restartRequestsRef.current);
      openTask(result.runId);
      await refreshTasks();
    } catch (cause) {
      restartRequestsRef.current = settleTaskRestart(restartRequestsRef.current, started.request, { phase: "uncertain", error: errorMessage(cause) });
      setRestartRequests(restartRequestsRef.current);
    }
  }

  async function controlTask(runId: string, action: TaskAction, stopAt?: AssistantDemoStop) {
    if (pending) return;
    const task =
      selected?.runId === runId
        ? selected
        : tasks.find((candidate) => candidate.runId === runId);
    if (!task) return;
    const started = beginTaskControl(
      controlRequestsRef.current,
      task,
      action,
      () => crypto.randomUUID(),
      stopAt,
    );
    if (!started) return;
    controlRequestsRef.current = started.requests;
    setControlRequests(started.requests);
    setPending(true);
    setActionError(undefined);
    try {
      await assistantRequest(
        `/api/assistant/tasks/${encodeURIComponent(runId)}`,
        {
          method: "POST",
          body: JSON.stringify({
            action,
            requestId: started.request.requestId,
            expectedCheckpointId: started.request.checkpointId,
            stopAt: started.request.stopAt,
          }),
        },
      );
      controlRequestsRef.current = settleTaskControl(
        controlRequestsRef.current,
        started.request,
        "accepted",
      );
      setControlRequests(controlRequestsRef.current);
      await refreshTasks();
      setSelectedRevision((value) => value + 1);
    } catch (cause) {
      controlRequestsRef.current = settleTaskControl(
        controlRequestsRef.current,
        started.request,
        "uncertain",
        errorMessage(cause),
      );
      setControlRequests(controlRequestsRef.current);
      setSelectedRevision((value) => value + 1);
    } finally {
      setPending(false);
    }
  }

  const activeTasks = tasks.filter((task) => !terminal.has(task.status));
  const visibleTasks = tasks.filter(
    (task) =>
      (filter === "all" ||
        (filter === "active"
          ? !terminal.has(task.status)
          : terminal.has(task.status))) &&
      `${task.title} ${task.prompt}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const listedSelection = tasks.find((task) => task.runId === selectedId);
  const detailedSelection =
    selectedTask?.runId === selectedId ? selectedTask : undefined;
  const selected =
    listedSelection && detailedSelection
      ? Date.parse(listedSelection.updatedAt) >
        Date.parse(detailedSelection.updatedAt)
        ? listedSelection
        : detailedSelection
      : (listedSelection ?? detailedSelection);
  const selectedControl = taskControlView(controlRequests, selected);
  const lastViewed = tasks.find((task) => task.runId === selectedTask?.runId);
  const lastViewedTask =
    lastViewed && selectedTask
      ? Date.parse(lastViewed.updatedAt) > Date.parse(selectedTask.updatedAt)
        ? lastViewed
        : selectedTask
      : (lastViewed ?? selectedTask);
  const previewTask = selected ?? lastViewedTask ?? activeTasks[0] ?? tasks[0];
  // Always-on shows the opened watch, or else the latest one.
  const selectedIsWatch = selected?.kind === "calendar_watch";
  const watchTasks = tasks.filter((task) => task.kind === "calendar_watch");
  const watch = selectedIsWatch
    ? selected
    : (watchTasks.find((task) => !terminal.has(task.status)) ?? watchTasks[0]);
  const watchControl = selectedIsWatch ? selectedControl : taskControlView(controlRequests, watch);
  const selectedRestart = selectedId ? restartRequests[selectedId] : undefined;
  const arrivedRestart = Object.values(restartRequests).find((request) => request.result?.runId === selectedId)?.result;
  const restartSubmitting = Object.values(restartRequests).some((request) => request.phase === "submitting");
  const showView = (
    next: AssistantView,
    run?: string,
    history: "push" | "replace" = "replace",
  ) => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    if (run) url.searchParams.set("run", run);
    if (history === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  };
  // A calendar watch opens under Always-on; every other run opens in Live run.
  function openTask(id: string, stepId?: string, target?: AssistantView) {
    const next =
      target ?? (tasks.find((task) => task.runId === id)?.kind === "calendar_watch" ? "story" : "run");
    if (next === "story") setStoryMode("calendar");
    if (id !== selectedId) setSelectedLoading(true);
    setSelectedError(undefined);
    setSelectedStepId(stepId);
    setOpenCount((value) => value + 1);
    setOffline(false);
    setActionError(undefined);
    showView(next, id, tab === next && id === selectedId ? "replace" : "push");
  }
  const retrySelected = () => {
    setSelectedLoading(true);
    setSelectedError(undefined);
    setSelectedRevision((value) => value + 1);
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Assistant</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBrowserOpenRequest((value) => value + 1)}
          >
            <GlobeIcon data-icon="inline-start" />
            Browser
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={signingOut ? "Signing out…" : `Sign out ${actor.email}`}
                  disabled={signingOut}
                  onClick={async () => {
                    setSigningOut(true);
                    setSignOutError(undefined);
                    try {
                      await signOut({ redirectTo: "/assistant" });
                    } catch (cause) {
                      setSignOutError(errorMessage(cause));
                    } finally {
                      setSigningOut(false);
                    }
                  }}
                />
              }
            >
              <LogOutIcon />
            </TooltipTrigger>
            <TooltipContent side="bottom">Sign out of {actor.email}</TooltipContent>
          </Tooltip>
          <Button
            size="sm"
            disabled={pending || restartSubmitting}
            onClick={() => void createTask(true)}
          >
            {demoStarting ? <LoaderCircleIcon className="motion-safe:animate-spin" data-icon="inline-start" /> : <FlaskConicalIcon data-icon="inline-start" />}
            {demoStarting ? "Starting…" : "Start demo"}
          </Button>
        </div>
      </header>

      {signOutError && (
        <Alert variant="destructive">
          <AlertTitle>Couldn’t sign out</AlertTitle>
          <AlertDescription>
            {signOutError} Check your connection and try again.
          </AlertDescription>
        </Alert>
      )}
      {actionError && !createOpen && (
        <Alert variant="destructive">
          <AlertTitle>Couldn’t start the demo</AlertTitle>
          <AlertDescription>
            <p>{actionError}</p>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => void createTask(true)}>Try again</Button>
          </AlertDescription>
        </Alert>
      )}

      <Tabs
        value={tab}
        className="min-w-0 gap-4"
        onValueChange={(value) => {
          if (!isAssistantView(value)) return;
          showView(value);
        }}
      >
        <div className="w-full min-w-0 overflow-x-auto">
          <TabsList
            variant="line"
            className="w-max min-w-full justify-start border-b pb-2"
          >
            <TabsTrigger
              value="assistant"
              className="flex-none px-2 text-xs sm:px-3 sm:text-sm"
            >
              Chat
            </TabsTrigger>
            <TabsTrigger
              value="story"
              className="flex-none px-2 text-xs sm:px-3 sm:text-sm"
            >
              Always-on
              {watch && !terminal.has(watch.status) && (
                <span
                  className="size-1.5 rounded-full bg-signal motion-safe:animate-pulse"
                  aria-label="Watching"
                />
              )}
            </TabsTrigger>
            <TabsTrigger
              value="run"
              className="flex-none px-2 text-xs sm:px-3 sm:text-sm"
            >
              Live run
              {selected && !selectedIsWatch && !terminal.has(selected.status) && (
                <span
                  className="size-1.5 rounded-full bg-signal motion-safe:animate-pulse"
                  aria-label="Active"
                />
              )}
            </TabsTrigger>
            <TabsTrigger
              value="inbox"
              className="flex-none px-2 text-xs sm:px-3 sm:text-sm"
            >
              Inbox
              {activeTasks.length > 0 && (
                <Badge variant="secondary">{activeTasks.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Couldn’t load the task inbox</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void refreshTasks()}
                >
                  Try again
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <TabsContent value="assistant" keepMounted className="min-w-0">
          <ChatSplit
            chat={
              <AssistantChat
                actorId={actor.id}
                onTaskChange={() => void refreshTasks()}
                onBrowsingChange={setBrowsing}
              />
            }
            side={
              <>
                <BrowserView watching={browsing} openRequest={browserOpenRequest} />
                {previewTask && (
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2"
                    aria-label={`Open the workflow: ${previewTask.title}, ${taskStatusLabel(previewTask)}`}
                    onClick={() => openTask(previewTask.runId)}
                  >
                    <span className="min-w-0 truncate">{previewTask.title}</span>
                    <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
                      {taskStatusLabel(previewTask)}
                    </span>
                    <ChevronRightIcon data-icon="inline-end" />
                  </Button>
                )}
              </>
            }
          />
        </TabsContent>

        <TabsContent value="run" keepMounted className="min-w-0">
          {selectedId && !selectedIsWatch ? (
            <RunViewer
              key={`${selectedId}:${openCount}`}
              task={selectedControl.task}
              active={tab === "run"}
              onAction={(id, action, stopAt) => void controlTask(id, action, stopAt)}
              pending={pending || selectedControl.pending}
              error={selectedControl.error}
              controlNotice={selectedControl.notice}
              loading={selectedLoading}
              loadError={selectedError}
              onRetry={retrySelected}
              initialStepId={selectedStepId}
              onRestart={(runId, eventId) => void restartTask(runId, eventId)}
              restartPending={restartSubmitting || pending || selectedControl.pending}
              restartError={selectedRestart?.phase === "uncertain" ? selectedRestart.error : undefined}
              restartEventId={selectedRestart?.phase === "uncertain" ? selectedRestart.eventId : undefined}
              restartNotice={arrivedRestart ? taskRestartNotice(arrivedRestart) : undefined}
              onOpenSource={(runId, stepId) => openTask(runId, stepId)}
              offline={offline}
              onOfflineChange={setOffline}
              syncedAt={syncedAt}
            />
          ) : (
            <section
              aria-label="Before the demo"
              className="grid min-w-0 items-start gap-8 rounded-lg border p-4 sm:p-6 lg:grid-cols-12"
            >
              <div className="flex min-w-0 flex-col gap-6 lg:order-2 lg:col-span-7">
                <div className="flex flex-col gap-2">
                  <h2 className="text-2xl font-semibold tracking-tight">
                    Follow one request through the agent
                  </h2>
                  <p className="max-w-xl leading-7 text-muted-foreground">
                    The request starts at the top and moves down one stage at
                    a time. The meeting is fictional, so nothing real is read
                    or sent.
                  </p>
                </div>
                <div className="flex flex-col items-start gap-1">
                  <Button
                    size="lg"
                    disabled={pending || restartSubmitting}
                    onClick={() => void createTask(true)}
                  >
                    {demoStarting ? (
                      <LoaderCircleIcon className="motion-safe:animate-spin" data-icon="inline-start" />
                    ) : (
                      <FlaskConicalIcon data-icon="inline-start" />
                    )}
                    {demoStarting ? "Starting…" : "Start demo"}
                  </Button>
                  <Button
                    variant="link"
                    className="px-0"
                    onClick={() => {
                      setStoryMode("example");
                      showView("story", undefined, "push");
                    }}
                  >
                    How is this different from a task agent?
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                </div>
              </div>
              <div className="min-w-0 lg:order-1 lg:col-span-5">
                <FlowDiagram
                  map={previewStageMap("meeting_prep")}
                  request={{ label: "Request", text: demoRequest }}
                />
              </div>
            </section>
          )}
        </TabsContent>

        <TabsContent value="story" keepMounted className="min-w-0">
          <div className="flex min-w-0 flex-col gap-6">
            <ToggleGroup
              aria-label="What to watch"
              variant="outline"
              size="sm"
              className="self-start"
              value={[storyMode]}
              onValueChange={(values) => {
                if (values[0] === "calendar" || values[0] === "example")
                  setStoryMode(values[0]);
              }}
            >
              <ToggleGroupItem value="calendar">Your calendar</ToggleGroupItem>
              <ToggleGroupItem value="example">Example week</ToggleGroupItem>
            </ToggleGroup>
            {storyMode === "calendar" && authorizationDenied && !watch && (
              <Alert>
                <AlertTitle>Calendar connection was declined</AlertTitle>
                <AlertDescription>
                  No new access was granted. You can connect again when you’re ready.
                </AlertDescription>
              </Alert>
            )}
            {storyMode === "calendar" &&
              (watch ? (
                <RunViewer
                  key={`watch:${watch.runId}:${openCount}`}
                  task={watchControl.task}
                  active={tab === "story" && storyMode === "calendar"}
                  onAction={(id, action) => void controlTask(id, action)}
                  pending={pending || watchControl.pending}
                  error={watchControl.error ?? watchError}
                  controlNotice={watchControl.notice}
                  loading={selectedIsWatch && selectedLoading}
                  loadError={selectedIsWatch ? selectedError : undefined}
                  onRetry={retrySelected}
                  initialStepId={selectedIsWatch ? selectedStepId : undefined}
                  onRestart={() => void startWatch()}
                  restartPending={watchStarting || pending}
                  offline={offline}
                  onOfflineChange={setOffline}
                  syncedAt={selectedIsWatch ? syncedAt : undefined}
                />
              ) : loading ? (
                <Skeleton className="h-96 w-full" />
              ) : (
                <CalendarWatchStart
                  status={calendar?.status}
                  loading={calendarLoading || (!calendar && !calendarError)}
                  error={calendarError ?? watchError}
                  starting={watchStarting}
                  onStart={() => void startWatch()}
                  onConnect={() => void connectCalendar()}
                  onRefresh={() => void refreshCalendar()}
                />
              ))}
            <div className={cn(storyMode !== "example" && "hidden")}>
              <AlwaysOnStory active={tab === "story" && storyMode === "example"} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="inbox" keepMounted className="min-w-0">
          <section className="overflow-hidden rounded-lg border">
            <div className="flex flex-wrap items-center gap-2 border-b p-4">
              <Input
                aria-label="Search tasks"
                className="min-w-48 flex-1 sm:max-w-xs"
                placeholder="Find a task…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="flex gap-1">
                {["all", "active", "finished"].map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={filter === value ? "secondary" : "ghost"}
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {value[0].toUpperCase() + value.slice(1)}
                  </Button>
                ))}
              </div>
              {calendar?.status.writeEnabled && calendar.status.state === "connected" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => setEventComposerOpen(true)}
                >
                  <CalendarPlusIcon data-icon="inline-start" />
                  Draft event
                </Button>
              )}
              <Button
                size="sm"
                className={cn(!(calendar?.status.writeEnabled && calendar.status.state === "connected") && "ml-auto")}
                onClick={() => {
                  setActionError(undefined);
                  setCreateOpen(true);
                }}
              >
                <PlusIcon data-icon="inline-start" />
                New task
              </Button>
            </div>
            {loading ? (
              <div
                className="flex flex-col gap-4 p-5"
                role="status"
                aria-label="Loading task inbox"
              >
                <span className="sr-only">Loading your tasks…</span>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : error && !tasks.length ? (
              <div className="p-5">
                <p className="text-sm text-muted-foreground">
                  Your tasks could not be loaded. Use Try again above to restore
                  the inbox.
                </p>
              </div>
            ) : visibleTasks.length ? (
              visibleTasks.map((task) => (
                <TaskRow key={task.runId} task={task} onOpen={openTask} />
              ))
            ) : (
              <Empty className="py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <InboxIcon />
                  </EmptyMedia>
                  <EmptyTitle>
                    {tasks.length
                      ? "No tasks match"
                      : "No tasks yet"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {tasks.length
                      ? "Try another search or switch the filter."
                      : "Start a rehearsal or ask your assistant to prepare for a meeting."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </section>
        </TabsContent>

      </Tabs>

      {eventComposerOpen && (
        <CalendarEventComposer
          onClose={() => setEventComposerOpen(false)}
          onCreated={(runId) => {
            setEventComposerOpen(false);
            openTask(runId);
            void refreshTasks();
          }}
        />
      )}

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent size="wide" className="gap-0">
          <SheetHeader className="border-b p-6 pr-12">
            <SheetTitle>New task</SheetTitle>
            <SheetDescription>
              Use fictional data or your connected calendar.
            </SheetDescription>
          </SheetHeader>
          <form
            className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6"
            onSubmit={(event) => {
              event.preventDefault();
              void createTask();
            }}
          >
            <Field>
              <FieldLabel>Source</FieldLabel>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant={mode === "rehearsal" ? "secondary" : "outline"}
                  aria-pressed={mode === "rehearsal"}
                  onClick={() => setMode("rehearsal")}
                >
                  <FlaskConicalIcon data-icon="inline-start" />
                  Synthetic rehearsal
                </Button>
                <Button
                  type="button"
                  variant={mode === "calendar" ? "secondary" : "outline"}
                  aria-pressed={mode === "calendar"}
                  onClick={() => setMode("calendar")}
                >
                  <CalendarDaysIcon data-icon="inline-start" />
                  My calendar
                </Button>
              </div>
              <FieldDescription>
                {mode === "rehearsal"
                  ? "Fictional meeting and notes; real workflow."
                  : "Uses your connected Google Calendar and a live AI brief."}
              </FieldDescription>
            </Field>
            {mode === "rehearsal" && (
              <Field>
                <FieldLabel>Execution</FieldLabel>
                <ToggleGroup
                  aria-label="Rehearsal execution"
                  variant="outline"
                  size="sm"
                  value={[demoMode ? "step" : "auto"]}
                  onValueChange={(values) => {
                    if (values[0]) setDemoMode(values[0] === "step");
                  }}
                >
                  <ToggleGroupItem value="step">Step by step</ToggleGroupItem>
                  <ToggleGroupItem value="auto">Automatic</ToggleGroupItem>
                </ToggleGroup>
                <FieldDescription>Step by step waits at real workflow checkpoints.</FieldDescription>
              </Field>
            )}
            <Field>
              <FieldLabel>Brief format</FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                {([3, 5] as const).map((count) => (
                  <Button
                    type="button"
                    key={count}
                    variant={
                      preference.bulletCount === count ? "secondary" : "outline"
                    }
                    aria-pressed={preference.bulletCount === count}
                    onClick={() =>
                      setPreference((value) => ({
                        ...value,
                        bulletCount: count,
                      }))
                    }
                  >
                    {count} bullets
                  </Button>
                ))}
                <label className="ml-2 flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={preference.includeLinks}
                    onCheckedChange={(checked) =>
                      setPreference((value) => ({
                        ...value,
                        includeLinks: checked === true,
                      }))
                    }
                  />
                  Source links
                </label>
              </div>
              <FieldDescription>
                Defaults apply to new tasks. Chat preferences stay in that chat.
              </FieldDescription>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={preferencePending}
                  onClick={() => void savePreference()}
                >
                  Save defaults
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={preferencePending}
                  onClick={() => void savePreference(true)}
                >
                  Reset defaults
                </Button>
              </div>
              {preferenceNotice && (
                <p className="text-xs text-muted-foreground" role="status">
                  {preferenceNotice}
                </p>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="task-title">Task name</FieldLabel>
              <Input
                id="task-title"
                maxLength={120}
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="task-prompt">
                {mode === "rehearsal"
                  ? "Task note"
                  : "Meeting preparation request"}
              </FieldLabel>
              <Textarea
                id="task-prompt"
                maxLength={2000}
                required
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
              {mode === "rehearsal" && (
                <FieldDescription>
                  Labels this task; the rehearsal uses a fixed fictional meeting.
                </FieldDescription>
              )}
            </Field>
            {mode === "rehearsal" && demoMode ? (
              <p className="text-xs leading-5 text-muted-foreground">
                Each stage waits for you. Delivery needs your review.
              </p>
            ) : (
              <>
            <Field>
              <FieldLabel htmlFor="task-delay">
                Start after (seconds)
              </FieldLabel>
              <Input
                className="max-w-40"
                id="task-delay"
                type="number"
                min={0}
                max={86400}
                required
                value={delay}
                onChange={(event) => setDelay(event.target.value)}
              />
              <FieldDescription>
                Three checks, 15 minutes apart. Use “Wake now” to skip a wait.
              </FieldDescription>
            </Field>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={manualStart}
                onCheckedChange={(checked) => setManualStart(checked === true)}
              />
              <span>
                Start manually
                <span className="mt-1 block text-xs text-muted-foreground">
                  Open the queued workflow before it runs.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={approval}
                onCheckedChange={(checked) => setApproval(checked === true)}
              />
              <span>
                Pause for review
                <span className="mt-1 block text-xs text-muted-foreground">
                  Approve inbox delivery. No messages are sent.
                </span>
              </span>
            </label>
              </>
            )}
            {actionError && (
              <Alert variant="destructive">
                <AlertTitle>Couldn’t create this task</AlertTitle>
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            )}
            <Button className="mt-auto" disabled={pending} type="submit">
              {pending ? (
                <LoaderCircleIcon
                  className="motion-safe:animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              {pending ? "Creating task…" : "Create task"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
