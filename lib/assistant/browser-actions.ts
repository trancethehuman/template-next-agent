import { z } from "zod";

/** The cloud browser's desktop, which the live view shows. */
export const browserScreen = { width: 1024, height: 768 } as const;

/** Pinned: agent-browser ships often, and its snapshot format is part of what the model reads. */
export const agentBrowserVersion = "0.41.0";

export const browserActions = [
  "navigate",
  "snapshot",
  "click",
  "fill",
  "type",
  "press",
  "select",
  "scroll",
  "back",
  "wait",
  "screenshot",
  "close",
] as const;

export type BrowserAction = (typeof browserActions)[number];

export const browserInputSchema = z.object({
  action: z.enum(browserActions),
  url: z.string().max(2000).optional().describe("navigate: the full http(s) address to open."),
  ref: z.string().max(12).optional().describe("click, fill, select: an element ref from the latest snapshot, such as @e3."),
  text: z.string().max(500).optional().describe("fill: the text that replaces the field's value. type: text typed wherever the focus is."),
  value: z.string().max(200).optional().describe("select: the option to choose."),
  keys: z.string().max(60).optional().describe("press: a key or combination, such as Enter, Tab, Escape, PageDown, or ctrl+a."),
  direction: z.enum(["up", "down"]).optional().describe("scroll: which way to scroll."),
  amount: z.number().int().min(100).max(3000).optional().describe("scroll: how many pixels, default 600."),
  seconds: z.number().min(0.5).max(5).optional().describe("wait: how long to wait, at most 5 seconds."),
});

export type BrowserInput = z.infer<typeof browserInputSchema>;

export interface BrowserResult {
  action: BrowserAction;
  /** One line for the model and the chat, such as “Clicked @e3”. */
  summary: string;
  /** The page after the action. */
  title?: string;
  url?: string;
  /** The page's interactive elements with refs, as agent-browser reports them. */
  snapshot?: string;
  /** A JPEG of the page after the action, base64, shown in the chat. */
  screenshot?: string;
  /** Why the action was refused or failed. */
  error?: string;
}

const keyNames: Record<string, string> = {
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  space: "Space",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  ctrl: "Control",
  control: "Control",
  cmd: "Control",
  meta: "Control",
  shift: "Shift",
  alt: "Alt",
};

/** Turns “ctrl+Enter” or “pagedown” into a key agent-browser accepts; anything else is refused. */
export function browserKeys(keys: string): string | undefined {
  const parts = keys.split("+").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return undefined;
  const mapped = parts.map((part) => {
    const named = keyNames[part.toLowerCase()];
    if (named) return named;
    if (/^f([1-9]|1[0-2])$/i.test(part)) return part.toUpperCase();
    return /^[A-Za-z0-9]$/.test(part) ? part.toLowerCase() : undefined;
  });
  return mapped.every(Boolean) ? mapped.join("+") : undefined;
}

/** An element ref from a snapshot, normalized to “@e12”. */
export function browserRef(ref: string | undefined): string | undefined {
  const match = ref?.trim().match(/^@?(e\d{1,6})$/);
  return match ? `@${match[1]}` : undefined;
}

function luhn(digits: string) {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** True when text contains something shaped like a payment card number. */
export function looksLikeCardNumber(text: string): boolean {
  for (const match of text.matchAll(/(?:\d[ -]?){13,19}/g)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
  }
  return false;
}

/** Validates an address before the browser opens it. Only web pages are allowed. */
export function browserUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** The model sometimes drops the @; the chat shows refs the way snapshots write them. */
const shownRef = (ref: string | undefined) => browserRef(ref) ?? ref;

/** How the chat names one action, with its detail in monospace beside it. */
export function browserActionLabel(input: Partial<BrowserInput> | undefined): { label: string; detail?: string } {
  switch (input?.action) {
    case "navigate":
      return { label: "Opening", detail: input.url };
    case "snapshot":
      return { label: "Reading the page" };
    case "click":
      return { label: "Clicking", detail: shownRef(input.ref) };
    case "fill":
      return { label: "Filling", detail: [shownRef(input.ref), input.text ? `“${input.text}”` : undefined].filter(Boolean).join(" ") };
    case "type":
      return { label: "Typing", detail: input.text ? `“${input.text}”` : undefined };
    case "press":
      return { label: "Pressing", detail: input.keys };
    case "select":
      return { label: "Choosing", detail: [shownRef(input.ref), input.value ? `“${input.value}”` : undefined].filter(Boolean).join(" ") };
    case "scroll":
      return { label: "Scrolling", detail: `${input.direction ?? "down"} ${input.amount ?? 600}px` };
    case "back":
      return { label: "Going back" };
    case "wait":
      return { label: "Waiting", detail: `${input.seconds ?? 1}s` };
    case "screenshot":
      return { label: "Looking at the page" };
    case "close":
      return { label: "Closing the browser" };
    default:
      return { label: "Using the browser" };
  }
}
