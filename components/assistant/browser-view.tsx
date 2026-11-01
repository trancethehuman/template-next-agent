"use client";

import { useEffect, useEffectEvent, useState } from "react";
import {
  EyeIcon,
  GlobeIcon,
  LoaderCircleIcon,
  Maximize2Icon,
  MousePointerClickIcon,
  PlayIcon,
  SquareIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { assistantRequest, errorMessage } from "@/lib/assistant/client";
import { cn } from "@/lib/utils";

type BrowserPage = { title: string; url: string };
export type BrowserState =
  | { state: "disabled" | "off" | "starting" }
  | { state: "stopped"; saved: boolean }
  | { state: "live"; viewUrl: string; controlUrl: string; page?: BrowserPage; sleepsAt?: string };

const keepAliveMs = 2 * 60_000;

/** Same URLs means the live view keeps its connection instead of reloading. */
function settle(current: BrowserState | undefined, next: BrowserState): BrowserState {
  return current?.state === "live" && next.state === "live" && current.viewUrl === next.viewUrl
    ? { ...next, viewUrl: current.viewUrl, controlUrl: current.controlUrl }
    : next;
}

/** One short line for the header: the page in front, or what the browser is doing. */
export function browserSubtitle(browser: BrowserState, busy?: "open" | "stop"): string | undefined {
  if (busy === "stop") return "Saving…";
  if (browser.state === "live") return browser.page?.title;
  if (busy === "open" || browser.state === "starting") return "Starting…";
  return browser.state === "stopped" ? "Asleep, tabs saved" : "Off";
}

/**
 * The user's cloud browser beside the chat. Anyone can start it from here
 * without the assistant; it sleeps with its tabs and sign-ins saved, and
 * resumes from the same disk. The live view grows with its panel; the large
 * view is where the user can take control, for example to sign in or pay.
 */
export function BrowserView({
  watching,
  openRequest = 0,
}: {
  /** The agent is browsing in this turn, so status updates quickly. */
  watching: boolean;
  /** Bump to start the browser if needed and open the large view. */
  openRequest?: number;
}) {
  const [browser, setBrowser] = useState<BrowserState>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<"open" | "stop">();
  const [expanded, setExpanded] = useState(false);
  const [control, setControl] = useState(false);
  const live = browser?.state === "live" ? browser : undefined;
  const starting = busy === "open" || browser?.state === "starting";

  // Poll quickly while something is happening; otherwise check now and then.
  const fast = watching || starting || Boolean(live) || busy === "stop";
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await assistantRequest<BrowserState>("/api/assistant/browser");
        if (active) {
          setBrowser((current) => settle(current, next));
          setError(undefined);
        }
      } catch (cause) {
        if (active) setError(errorMessage(cause));
      } finally {
        if (active) timer = setTimeout(poll, fast ? 3000 : 30_000);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [fast]);

  // While the owner can see it, the browser stays awake instead of sleeping mid-look.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void assistantRequest("/api/assistant/browser", { method: "POST", body: JSON.stringify({ action: "keepalive" }) }).catch(() => undefined);
    }, keepAliveMs);
    return () => clearInterval(timer);
  }, [live]);

  async function open() {
    setBusy("open");
    setError(undefined);
    try {
      const next = await assistantRequest<BrowserState>("/api/assistant/browser", {
        method: "POST",
        body: JSON.stringify({ action: "open" }),
      });
      setBrowser((current) => settle(current, next));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function stop() {
    setBusy("stop");
    setError(undefined);
    try {
      setBrowser(await assistantRequest<BrowserState>("/api/assistant/browser", { method: "DELETE" }));
      setExpanded(false);
      setControl(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  // The header's Browser button: show it large now, and wake it if needed.
  const [handledRequest, setHandledRequest] = useState(openRequest);
  const [wakeRequested, setWakeRequested] = useState(false);
  if (openRequest !== handledRequest) {
    setHandledRequest(openRequest);
    setExpanded(true);
    setWakeRequested(true);
  }
  const wake = useEffectEvent(() => {
    setWakeRequested(false);
    if (!live && !starting) void open();
  });
  useEffect(() => {
    if (!wakeRequested) return;
    const timer = setTimeout(wake, 0);
    return () => clearTimeout(timer);
  }, [wakeRequested]);

  if (!browser || browser.state === "disabled") return null;

  return (
    <section aria-label="Cloud browser" className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
        <GlobeIcon className="size-4 shrink-0" aria-hidden="true" />
        <h2 className="shrink-0 text-sm font-semibold">Browser</h2>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground" title={live?.page?.url}>
          {live && <span className="size-1.5 shrink-0 rounded-full bg-signal" aria-label="Live" />}
          <span className="truncate">{browserSubtitle(browser, busy)}</span>
        </span>
        {live ? (
          <>
            <Button size="icon-sm" variant="ghost" aria-label="Open the large view" onClick={() => setExpanded(true)}>
              <Maximize2Icon />
            </Button>
            <Button size="sm" variant="ghost" disabled={busy === "stop"} onClick={() => void stop()}>
              <SquareIcon data-icon="inline-start" />
              Stop
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" disabled={busy !== undefined} onClick={() => void open()}>
            {starting ? (
              <LoaderCircleIcon data-icon="inline-start" className="motion-safe:animate-spin" />
            ) : (
              <PlayIcon data-icon="inline-start" />
            )}
            {browser.state === "stopped" ? "Resume" : browser.state === "starting" && !busy ? "Open" : "Start"}
          </Button>
        )}
      </div>

      {live && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Open the large browser view"
          className="block aspect-4/3 w-full border-t bg-black outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <iframe
            src={live.viewUrl}
            title="Cloud browser, small view"
            className="pointer-events-none size-full border-0"
            tabIndex={-1}
          />
        </button>
      ) : (
        <p className="border-t px-3 py-2 text-xs leading-5 text-muted-foreground" role="status">
          {busy === "stop"
            ? "Saving your tabs and sign-ins."
            : live
              ? "Showing in the large view."
              : starting
                ? "The first start installs Chrome, about a minute."
                : browser.state === "stopped"
                  ? "Resumes with your tabs and sign-ins."
                  : "Chrome in a cloud sandbox, for you or the assistant."}
        </p>
      )}
      {error && <p className="border-t px-3 py-2 text-xs text-destructive">{error}</p>}

      <Dialog
        open={expanded}
        onOpenChange={(value) => {
          setExpanded(value);
          if (!value) setControl(false);
        }}
      >
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Cloud browser</DialogTitle>
            <DialogDescription>
              {busy === "stop"
                ? "Saving your tabs and sign-ins. Closing Chrome and saving the disk takes about half a minute."
                : !live
                  ? "Starting your browser. Saved tabs and sign-ins come back with it."
                  : control
                    ? "You have control. Finish sign-in or payment yourself; the assistant never types those."
                    : "Watch only. Take control to use it yourself."}
            </DialogDescription>
          </DialogHeader>
          <div className={cn("flex aspect-4/3 w-full items-center justify-center overflow-hidden rounded-md bg-black", control && "ring-2 ring-signal")}>
            {live ? (
              <iframe
                key={control ? "control" : "view"}
                src={control ? live.controlUrl : live.viewUrl}
                title={control ? "Cloud browser, you have control" : "Cloud browser, watch only"}
                className="size-full border-0"
              />
            ) : (
              <p className="flex items-center gap-2 text-sm text-white" role="status">
                <LoaderCircleIcon className="size-4 motion-safe:animate-spin" aria-hidden="true" />
                {busy === "stop" ? "Saving…" : "Starting Chrome…"}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!live} variant={control ? "outline" : "default"} onClick={() => setControl((value) => !value)}>
              {control ? <EyeIcon data-icon="inline-start" /> : <MousePointerClickIcon data-icon="inline-start" />}
              {control ? "Watch only" : "Take control"}
            </Button>
            <Button variant="ghost" disabled={!live || busy === "stop"} onClick={() => void stop()}>
              <SquareIcon data-icon="inline-start" />
              {busy === "stop" ? "Saving…" : "Stop and save"}
            </Button>
            {live?.page && (
              <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground" title={live.page.url}>
                {live.page.title}
              </span>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
