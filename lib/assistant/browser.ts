import { createHash, createHmac } from "node:crypto";
import { APIError, Sandbox } from "@vercel/sandbox";
import type { AssistantActor } from "@/lib/auth/actor";
import {
  agentBrowserVersion,
  browserKeys,
  browserRef,
  browserScreen,
  browserUrl,
  looksLikeCardNumber,
  type BrowserInput,
  type BrowserResult,
} from "./browser-actions";

/**
 * Each signed-in user gets one cloud browser: a persistent Vercel Sandbox
 * running Chrome on a small VNC desktop. The agent drives that same Chrome
 * through agent-browser over its local debugging port, reading the page as
 * an accessibility snapshot with element refs; the owner watches it through a
 * password-protected noVNC page. Server-only. Nothing here enters or reads the owner's own browser.
 */

const novncPort = 6080;
const display = { DISPLAY: ":99" };
// A session ends after this long without being kept alive, saving its disk first.
const sessionTimeoutMs = 20 * 60_000;
const keepAliveBelowMs = 8 * 60_000;
const keepAliveByMs = 15 * 60_000;
// Chrome's debugging port stays inside the sandbox; only the live view is exposed.
const cdpPort = 9222;
const savedTabs = "$HOME/.assistant-browser/tabs.json";
// Chrome ignores the debugging port on its default profile, so it gets its own.
const profile = "$HOME/.assistant-browser/chrome";
const installed = "/opt/assistant-browser/installed";
// Every agent-browser call attaches to the visible Chrome through one named session.
const agentBrowserEnv = { ...display, AGENT_BROWSER_CDP: String(cdpPort), AGENT_BROWSER_SESSION: "live" };

export class BrowserError extends Error {
  constructor(
    public readonly code: "disabled" | "not_configured" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "BrowserError";
  }
}

export function browserEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.ASSISTANT_BROWSER_ENABLED !== "false";
}

/** A stable, non-reversible sandbox name per account. Names are unique per Vercel project. */
export function browserSandboxName(actor: Pick<AssistantActor, "id">): string {
  return `assistant-browser-${createHash("sha256").update(`assistant-browser:${actor.id}`).digest("hex").slice(0, 24)}`;
}

/** The VNC password is derived, never stored. VNC uses only the first 8 characters. */
export function browserPassword(name: string, secret = process.env.AUTH_SECRET): string {
  if (!secret)
    throw new BrowserError("not_configured", "Set AUTH_SECRET before using the cloud browser.");
  return createHmac("sha256", secret).update(`assistant-browser-vnc:${name}`).digest("base64url").slice(0, 8);
}

const installScript = `set -e
exec 9>/tmp/assistant-install.lock
flock 9
export DEBIAN_FRONTEND=noninteractive
if [ ! -f ${installed} ]; then
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends tigervnc-standalone-server tigervnc-tools openbox xdotool imagemagick novnc python3-websockify fonts-liberation fonts-noto-color-emoji wget ca-certificates curl >/dev/null
  cd /tmp
  wget -q -O chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y -qq ./chrome.deb >/dev/null
  rm -f chrome.deb
  mkdir -p /opt/assistant-browser
  touch ${installed}
fi
# agent-browser drives the visible Chrome over its debugging port. Its npm
# package bundles the Linux binary, so no install scripts or Chromium download run.
if [ "$(agent-browser --version 2>/dev/null)" != "agent-browser ${agentBrowserVersion}" ]; then
  npm install -g --ignore-scripts agent-browser@${agentBrowserVersion} >/dev/null 2>&1
fi`;

/** Saves the open tabs, so a resumed browser can reopen them even if Chrome did not. */
const saveTabs = `mkdir -p "$HOME/.assistant-browser" && curl -sf http://127.0.0.1:${cdpPort}/json/list -o "${savedTabs}.tmp" && mv "${savedTabs}.tmp" "${savedTabs}"`;

/**
 * agent-browser drives its own tab over CDP without raising it, so the live
 * view would keep showing whatever tab was in front. This brings the agent's
 * tab forward so the owner watches the page being used.
 */
const showAgentTab = `id=$(agent-browser tab --json | python3 -c 'import json, sys; print(next((t["targetId"] for t in json.load(sys.stdin)["data"]["tabs"] if t.get("active")), ""))') && [ -n "$id" ] && curl -sf -o /dev/null "http://127.0.0.1:${cdpPort}/json/activate/$id"`;

/** Reopens saved web pages when Chrome comes back with only blank tabs. */
const restoreTabs = `python3 - <<'PY' || true
import json, os, urllib.parse, urllib.request
base = "http://127.0.0.1:${cdpPort}"
web = lambda tabs: [t["url"] for t in tabs if t.get("type") == "page" and t.get("url", "").startswith(("http://", "https://"))]
try:
    saved = web(json.load(open(os.path.expanduser("~/.assistant-browser/tabs.json"))))
except Exception:
    saved = []
if saved and not web(json.load(urllib.request.urlopen(base + "/json/list", timeout=5))):
    for url in saved[:8]:
        urllib.request.urlopen(urllib.request.Request(base + "/json/new?" + urllib.parse.quote(url, safe=":/?&=%#+,;@~"), method="PUT"), timeout=5)
PY`;

/** Starts only what is not already running, then waits until the live view answers. */
const startScript = `set -e
exec 9>/tmp/assistant-start.lock
flock 9
export DISPLAY=:99
if ! xdotool getdisplaygeometry >/dev/null 2>&1; then
  rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
  mkdir -p "$HOME/.vnc"
  printf '%s\\n' "$VNC_PASSWORD" | vncpasswd -f > "$HOME/.vnc/passwd"
  chmod 600 "$HOME/.vnc/passwd"
  setsid nohup Xvnc :99 -geometry ${browserScreen.width}x${browserScreen.height} -depth 24 -rfbport 5900 -localhost yes -SecurityTypes VncAuth -PasswordFile "$HOME/.vnc/passwd" -AlwaysShared </dev/null >/tmp/assistant-xvnc.log 2>&1 9>&- &
  for i in $(seq 1 50); do xdotool getdisplaygeometry >/dev/null 2>&1 && break; sleep 0.2; done
fi
# Background only the program: a backgrounded "a || b" list would keep the lock open.
if ! pgrep -x openbox >/dev/null; then
  setsid nohup openbox </dev/null >/dev/null 2>&1 9>&- &
fi
if ! pgrep -x websockify >/dev/null; then
  setsid nohup websockify --web /usr/share/novnc ${novncPort} localhost:5900 </dev/null >/tmp/assistant-websockify.log 2>&1 9>&- &
fi
if ! curl -sf -o /dev/null http://127.0.0.1:${cdpPort}/json/version || ! xdotool search --onlyvisible --class google-chrome >/dev/null 2>&1; then
  # A resumed disk keeps the old session's profile lock, which blocks Chrome.
  pkill -x chrome || true
  sleep 0.5
  mkdir -p "$HOME/.assistant-browser"
  # Earlier versions used Chrome's default profile; move it once so sign-ins carry over.
  if [ ! -d "${profile}" ] && [ -d "$HOME/.config/google-chrome" ]; then mv "$HOME/.config/google-chrome" "${profile}"; fi
  rm -f "${profile}/"Singleton*
  command -v agent-browser >/dev/null && agent-browser close >/dev/null 2>&1 || true
  setsid nohup google-chrome --no-sandbox --test-type --disable-gpu --disable-dev-shm-usage --no-first-run --no-default-browser-check --start-maximized --hide-crash-restore-bubble --restore-last-session --remote-debugging-port=${cdpPort} --user-data-dir="${profile}" --disable-features=Translate --password-store=basic </dev/null >/tmp/assistant-chrome.log 2>&1 9>&- &
fi
for i in $(seq 1 60); do
  curl -sf -o /dev/null http://localhost:${novncPort}/vnc.html && curl -sf -o /dev/null http://127.0.0.1:${cdpPort}/json/version && break
  sleep 0.5
done
${restoreTabs}
for i in $(seq 1 20); do
  xdotool search --onlyvisible --class google-chrome >/dev/null 2>&1 && exit 0
  sleep 0.5
done
echo "The desktop did not start." >&2
exit 1`;

const healthScript = `command -v agent-browser >/dev/null && xdotool search --onlyvisible --class google-chrome >/dev/null 2>&1 && curl -sf -o /dev/null http://localhost:${novncPort}/vnc.html && curl -sf -o /dev/null http://127.0.0.1:${cdpPort}/json/version`;

async function bash(sandbox: Sandbox, script: string, options: { sudo?: boolean; env?: Record<string, string> } = {}) {
  const result = await sandbox.runCommand({ cmd: "bash", args: ["-c", script], env: { ...display, ...options.env }, sudo: options.sudo });
  return { exitCode: result.exitCode, stdout: await result.stdout(), stderr: await result.stderr() };
}

function notFound(error: unknown) {
  return error instanceof APIError && error.response.status === 404;
}

/** The owner's browser sandbox, created, installed, and started as needed. */
export async function openBrowser(actor: Pick<AssistantActor, "id">): Promise<Sandbox> {
  if (!browserEnabled())
    throw new BrowserError("disabled", "The cloud browser is turned off for this deployment.");
  const name = browserSandboxName(actor);
  const password = browserPassword(name);
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.getOrCreate({
      name,
      persistent: true,
      resume: true,
      ports: [novncPort],
      timeout: sessionTimeoutMs,
      resources: { vcpus: 2 },
      keepLastSnapshots: { count: 1 },
      tags: { app: "assistant-browser" },
    });
  } catch {
    throw new BrowserError("unavailable", "The cloud browser could not start. Check the Vercel Sandbox credentials (VERCEL_OIDC_TOKEN locally), then try again.");
  }
  if ((await bash(sandbox, healthScript)).exitCode === 0) {
    await extendIfNeeded(sandbox);
    return sandbox;
  }
  // The first start for an account installs Chrome and the desktop, about a minute.
  const install = await bash(sandbox, installScript, { sudo: true });
  if (install.exitCode !== 0)
    throw new BrowserError("unavailable", "The cloud browser could not install Chrome. Try again in a moment.");
  // The desktop keeps running after the script exits, so start it detached and
  // let the health check, not the command, decide when it is ready.
  await sandbox.runCommand({ cmd: "bash", args: ["-c", startScript], env: { ...agentBrowserEnv, VNC_PASSWORD: password }, detached: true });
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await bash(sandbox, healthScript)).exitCode === 0) return sandbox;
    await pause(500);
  }
  throw new BrowserError("unavailable", "The cloud browser's desktop did not start. Try again in a moment.");
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One agent-browser command over the visible Chrome, with its JSON result. */
async function agentBrowser(sandbox: Sandbox, args: string[]): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const result = await sandbox.runCommand({ cmd: "agent-browser", args: [...args, "--json"], env: agentBrowserEnv });
  const line = (await result.stdout()).trim().split("\n").at(-1) ?? "";
  try {
    const json = JSON.parse(line) as { success?: boolean; data?: Record<string, unknown>; error?: unknown };
    return { ok: Boolean(json.success), data: json.data, error: typeof json.error === "string" ? json.error : undefined };
  } catch {
    return { ok: false, error: (await result.stderr()).trim().slice(-300) || "The browser returned no result." };
  }
}

const snapshotLimit = 12_000;

/** What the page looks like after an action: its elements, title, address, and a screenshot. */
async function observe(sandbox: Sandbox): Promise<Pick<BrowserResult, "snapshot" | "title" | "url" | "screenshot">> {
  const snapshot = await agentBrowser(sandbox, ["snapshot", "-i", "-c"]);
  const title = await agentBrowser(sandbox, ["get", "title"]);
  const shot = await agentBrowser(sandbox, ["screenshot", "/tmp/assistant-shot.jpg", "--screenshot-format", "jpeg", "--screenshot-quality", "60"]);
  const buffer = shot.ok ? await sandbox.readFileToBuffer({ path: "/tmp/assistant-shot.jpg" }) : null;
  await bash(sandbox, `${showAgentTab}; ${saveTabs}`, { env: agentBrowserEnv }).catch(() => undefined);
  const tree = typeof snapshot.data?.snapshot === "string" ? snapshot.data.snapshot : undefined;
  return {
    snapshot: tree && tree.length > snapshotLimit ? `${tree.slice(0, snapshotLimit)}\n… (more elements; scroll or use a narrower page)` : tree || undefined,
    title: typeof title.data?.title === "string" ? title.data.title.slice(0, 200) : undefined,
    url: typeof snapshot.data?.origin === "string" ? snapshot.data.origin.slice(0, 2000) : undefined,
    screenshot: buffer?.toString("base64"),
  };
}

/** Runs one action on the owner's cloud browser, then reads the page and captures it. */
export async function runBrowserAction(actor: Pick<AssistantActor, "id">, input: BrowserInput): Promise<BrowserResult> {
  const refuse = (error: string): BrowserResult => ({ action: input.action, summary: error, error });
  const ref = browserRef(input.ref);
  if (["click", "fill", "select"].includes(input.action) && !ref)
    return refuse("This action needs an element ref from the latest snapshot, such as @e3.");
  if (input.action === "fill" || input.action === "type") {
    if (!input.text) return refuse("This action needs text.");
    if (looksLikeCardNumber(input.text))
      return refuse("Refused: that looks like a payment card number. Ask the user to enter payment details themselves.");
  }
  if (input.action === "select" && !input.value) return refuse("Choosing needs the option's value.");
  const url = browserUrl(input.url);
  if (input.action === "navigate" && !url) return refuse("Navigate needs a full http or https address.");
  const keys = input.action === "press" ? browserKeys(input.keys ?? "") : undefined;
  if (input.action === "press" && !keys) return refuse(`Unknown key “${input.keys ?? ""}”. Use names like Enter, Tab, Escape, PageDown, or ctrl+a.`);

  if (input.action === "close") {
    await stopBrowser(actor);
    return { action: "close", summary: "Closed the cloud browser. Its tabs and sign-ins are saved for next time." };
  }

  const sandbox = await openBrowser(actor);
  const commands: Partial<Record<BrowserInput["action"], { args: string[]; summary: string; settle: number }>> = {
    navigate: { args: ["open", url!], summary: `Opened ${url}`, settle: 500 },
    click: { args: ["click", ref!], summary: `Clicked ${ref}`, settle: 1200 },
    fill: { args: ["fill", ref!, input.text ?? ""], summary: `Filled ${ref} with “${input.text}”`, settle: 300 },
    type: { args: ["keyboard", "type", input.text ?? ""], summary: `Typed “${input.text}”`, settle: 300 },
    press: { args: ["press", keys!], summary: `Pressed ${keys}`, settle: 1000 },
    select: { args: ["select", ref!, input.value ?? ""], summary: `Chose “${input.value}” in ${ref}`, settle: 500 },
    scroll: { args: ["scroll", input.direction ?? "down", String(input.amount ?? 600)], summary: `Scrolled ${input.direction ?? "down"} ${input.amount ?? 600}px`, settle: 400 },
    back: { args: ["back"], summary: "Went back", settle: 1000 },
  };
  const command = commands[input.action];
  let summary = input.action === "wait" ? `Waited ${input.seconds ?? 1}s` : input.action === "screenshot" ? "Looked at the page" : "Read the page";
  let error: string | undefined;
  if (command) {
    const result = await agentBrowser(sandbox, command.args);
    if (result.ok) summary = command.summary;
    else {
      error = result.error ?? "The browser could not do that.";
      summary = `${command.summary.split(" ")[0]} failed: ${error}`;
    }
    await pause(command.settle);
  } else if (input.action === "wait") await pause((input.seconds ?? 1) * 1000);
  // A failed action still returns the fresh page, so the model can pick a new ref.
  return { action: input.action, summary, ...(error ? { error } : {}), ...(await observe(sandbox)) };
}

export interface BrowserPage {
  title: string;
  url: string;
}

export type BrowserStatus =
  | { state: "disabled" | "off" | "starting" }
  | { state: "stopped"; saved: boolean }
  | { state: "live"; viewUrl: string; controlUrl: string; page?: BrowserPage; sleepsAt?: string };

/** The page in front, from Chrome's own tab list. */
export function frontPage(tabsJson: string): BrowserPage | undefined {
  try {
    const tabs = JSON.parse(tabsJson) as Array<{ type?: string; title?: string; url?: string }>;
    const page = tabs.find((tab) => tab.type === "page" && /^https?:\/\//.test(tab.url ?? ""));
    return page?.url ? { title: (page.title || page.url).slice(0, 200), url: page.url.slice(0, 2000) } : undefined;
  } catch {
    return undefined;
  }
}

/** Gives a session more time when it is close to sleeping. The plan's session cap still applies. */
async function extendIfNeeded(sandbox: Sandbox) {
  const left = (sandbox.expiresAt?.getTime() ?? 0) - Date.now();
  if (left < keepAliveBelowMs) await sandbox.extendTimeout(keepAliveByMs).catch(() => undefined);
}

async function getBrowser(actor: Pick<AssistantActor, "id">): Promise<Sandbox | undefined> {
  try {
    return await Sandbox.get({ name: browserSandboxName(actor), resume: false });
  } catch (error) {
    if (notFound(error)) return undefined;
    throw new BrowserError("unavailable", "The cloud browser's status is unavailable.");
  }
}

/** What the owner's live view should show right now. It never starts or resumes the browser. */
export async function browserStatus(actor: Pick<AssistantActor, "id">): Promise<BrowserStatus> {
  if (!browserEnabled()) return { state: "disabled" };
  const sandbox = await getBrowser(actor);
  if (!sandbox) return { state: "off" };
  if (sandbox.status === "pending") return { state: "starting" };
  if (sandbox.status !== "running") return { state: "stopped", saved: Boolean(sandbox.currentSnapshotId) };
  const health = await bash(sandbox, `${healthScript} && curl -sf http://127.0.0.1:${cdpPort}/json/list`);
  if (health.exitCode !== 0) return { state: "starting" };
  const base = `${sandbox.domain(novncPort)}/vnc.html?autoconnect=1&resize=scale&reconnect=1&reconnect_delay=1000&show_dot=1&password=${encodeURIComponent(browserPassword(sandbox.name))}`;
  return {
    state: "live",
    viewUrl: `${base}&view_only=1`,
    controlUrl: `${base}&view_only=0`,
    page: frontPage(health.stdout),
    sleepsAt: sandbox.expiresAt?.toISOString(),
  };
}

/** Keeps a running browser awake while its owner is watching. It never resumes a sleeping one. */
export async function keepBrowserAlive(actor: Pick<AssistantActor, "id">): Promise<void> {
  const sandbox = await getBrowser(actor);
  if (sandbox?.status === "running") await extendIfNeeded(sandbox);
}

/**
 * Saves the open tabs, lets Chrome close cleanly so its session and cookies
 * are on disk, then stops compute. The persistent disk is snapshotted on stop
 * and restored on the next start.
 */
export async function stopBrowser(actor: Pick<AssistantActor, "id">): Promise<void> {
  const sandbox = await getBrowser(actor);
  if (!sandbox || !["running", "pending"].includes(sandbox.status)) return;
  if (sandbox.status === "running")
    await bash(sandbox, `${saveTabs} || true; pkill -TERM -x chrome || true; for i in $(seq 1 20); do pgrep -x chrome >/dev/null || break; sleep 0.25; done; sync`).catch(() => undefined);
  await sandbox.stop();
}
