"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useEveAgent } from "eve/react";
import type { EveMessageInputRequest } from "eve/react";
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  CameraIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleStopIcon,
  ClockIcon,
  GlobeIcon,
  KeyboardIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  MousePointerClickIcon,
  PlusIcon,
  ScanTextIcon,
  ScrollTextIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  browserActionLabel,
  type BrowserAction,
  type BrowserInput,
  type BrowserResult,
} from "@/lib/assistant/browser-actions";
import { errorMessage } from "@/lib/assistant/client";
import {
  assistantModelCookie,
  assistantModelFromCookie,
  assistantModels,
  defaultAssistantModel,
  type AssistantModelId,
} from "@/lib/assistant/models";

const sessionKey = (actorId: string) => `assistant.session.v2.${actorId}`;

/** A tool name in plain words: "read_calendar" becomes "Read calendar". */
function toolLabel(name: string) {
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const browserIcons: Record<BrowserAction, typeof GlobeIcon> = {
  navigate: GlobeIcon,
  snapshot: ScanTextIcon,
  click: MousePointerClickIcon,
  fill: KeyboardIcon,
  type: KeyboardIcon,
  press: KeyboardIcon,
  select: ListChecksIcon,
  scroll: ScrollTextIcon,
  back: ArrowLeftIcon,
  wait: ClockIcon,
  screenshot: CameraIcon,
  close: XIcon,
};

/** The screen right after an action. Click it to see it full size. */
function BrowserScreenshot({ screenshot, title }: { screenshot: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const src = `data:image/jpeg;base64,${screenshot}`;
  const alt = title ? `Screenshot of ${title}` : "Screenshot of the cloud browser";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Enlarge: ${alt}`}
        className="block w-32 shrink-0 overflow-hidden rounded-sm border bg-background outline-none hover:ring-2 hover:ring-ring/40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Image src={src} alt={alt} width={1024} height={680} unoptimized className="h-auto w-full" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{title ?? "Cloud browser"}</DialogTitle>
          </DialogHeader>
          <Image src={src} alt={alt} width={1024} height={680} unoptimized className="h-auto w-full rounded-md border" />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One cloud-browser action, as a row: what it did, where, and whether it worked. */
export function BrowserActionRow({
  input,
  output,
  state,
}: {
  input?: Partial<BrowserInput>;
  output?: BrowserResult;
  state: string;
}) {
  const { label, detail } = browserActionLabel(input);
  const Icon = (input?.action && browserIcons[input.action]) || GlobeIcon;
  const running = state === "input-streaming" || state === "input-available";
  const failed = state === "output-error" || Boolean(output?.error);
  return (
    <div className="flex items-start gap-3 rounded-sm border bg-muted/40 p-2 text-xs">
      {output?.screenshot && <BrowserScreenshot screenshot={output.screenshot} title={output.title} />}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex min-w-0 items-center gap-2">
          <Icon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="shrink-0 font-medium">{label}</span>
          <span className="ml-auto shrink-0" aria-label={running ? "Working" : failed ? "Not done" : state === "output-available" ? "Done" : undefined}>
            {running ? (
              <LoaderCircleIcon aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />
            ) : failed ? (
              <CircleAlertIcon aria-hidden="true" className="size-3.5 text-destructive" />
            ) : state === "output-available" ? (
              <CheckIcon aria-hidden="true" className="size-3.5" />
            ) : null}
          </span>
        </p>
        {detail && <p className="truncate font-mono text-muted-foreground" title={detail}>{detail}</p>}
        {output?.error && <p className="text-destructive">{output.summary}</p>}
      </div>
    </div>
  );
}

function storedModel(): AssistantModelId {
  try {
    return assistantModelFromCookie(document.cookie) ?? defaultAssistantModel;
  } catch {
    return defaultAssistantModel;
  }
}

/** The model for this chat. It is saved in a cookie and applies from the next message. */
function ModelPicker({ disabled }: { disabled: boolean }) {
  const [model, setModel] = useState<AssistantModelId>(storedModel);
  return (
    <Select
      value={model}
      disabled={disabled}
      onValueChange={(value) => {
        const next = assistantModels.find((item) => item.id === value);
        if (!next) return;
        setModel(next.id);
        document.cookie = `${assistantModelCookie}=${encodeURIComponent(next.id)}; Path=/; Max-Age=31536000; SameSite=Lax`;
      }}
      items={assistantModels.map((item) => ({ value: item.id, label: item.label }))}
    >
      <SelectTrigger size="sm" aria-label="Model" className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false} className="min-w-64">
        <SelectGroup>
          {assistantModels.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.label}
              <span className="text-muted-foreground">{item.note}</span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function recoverUnacceptedDraft(
  currentDraft: string,
  submitted: { text: string; accepted: boolean } | undefined,
  failed: boolean,
): string {
  return failed && submitted && !submitted.accepted && !currentDraft
    ? submitted.text
    : currentDraft;
}

export function AssistantInputRequest({
  request,
  prompt,
  disabled,
  answer,
  onAnswerChange,
  onRespond,
}: {
  request: EveMessageInputRequest;
  /** Plain words for the request, in place of the runtime's generic prompt. */
  prompt?: string;
  disabled: boolean;
  answer: string;
  onAnswerChange: (value: string) => void;
  onRespond: (optionId?: string) => void;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 py-2">
      <legend className="text-sm font-medium">
        {request.kind === "session-limit"
          ? "Continue this conversation?"
          : request.kind === "tool-approval"
            ? "Your approval is needed"
            : "A question for you"}
      </legend>
      <MessageResponse>{prompt ?? request.prompt}</MessageResponse>
      {request.kind === "session-limit" && (
        <p className="text-xs leading-5 text-muted-foreground">
          Continues this chat; does not approve a task or Calendar write.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {request.options?.map((option) => (
          <Button
            key={option.id}
            type="button"
            size="sm"
            title={option.description}
            variant={
              option.style === "danger"
                ? "destructive"
                : option.style === "primary"
                  ? "default"
                  : "outline"
            }
            disabled={disabled}
            onClick={() => onRespond(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {request.allowFreeform && (
        <div className="flex flex-col gap-2">
          <label
            htmlFor={`answer-${request.requestId}`}
            className="text-xs font-medium"
          >
            Your answer
          </label>
          <Textarea
            id={`answer-${request.requestId}`}
            maxLength={2000}
            value={answer}
            disabled={disabled}
            onChange={(event) => onAnswerChange(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            className="self-start"
            disabled={disabled || !answer.trim()}
            onClick={() => onRespond()}
          >
            Send answer
          </Button>
        </div>
      )}
    </fieldset>
  );
}

function savedSession(actorId: string): string | undefined {
  try {
    const id = localStorage.getItem(sessionKey(actorId));
    return id && /^wrun_[a-zA-Z0-9_-]+$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export function AssistantChat({
  actorId,
  onTaskChange,
  onBrowsingChange,
}: {
  actorId: string;
  onTaskChange: () => void;
  /** Called while the agent is using the cloud browser in this turn. */
  onBrowsingChange?: (browsing: boolean) => void;
}) {
  const [initialId] = useState(() => savedSession(actorId));
  const [input, setInput] = useState("");
  const [localError, setLocalError] = useState<string>();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [respondingTo, setRespondingTo] = useState<string>();
  const submittedDraft = useRef<
    { text: string; accepted: boolean } | undefined
  >(undefined);
  const agent = useEveAgent({
    // Only durable receipts render as sent messages; failed sends stay drafts.
    optimistic: false,
    initialSession: initialId
      ? { sessionId: initialId, streamIndex: 0 }
      : undefined,
    resume: Boolean(initialId),
    onSessionChange(session) {
      try {
        if (session)
          localStorage.setItem(sessionKey(actorId), session.sessionId);
        else localStorage.removeItem(sessionKey(actorId));
      } catch {
        /* The durable server session remains usable without browser storage. */
      }
    },
    onEvent(event) {
      if (event.type === "message.received" && submittedDraft.current)
        submittedDraft.current.accepted = true;
    },
    onError(cause) {
      setLocalError(errorMessage(cause));
    },
    onFinish(snapshot) {
      // EVE resolves send() after recording a transport error. Restore a draft
      // only if no durable receipt confirmed it, and preserve a newly typed one.
      const submitted = submittedDraft.current;
      if (snapshot.status === "error")
        setInput((current) => recoverUnacceptedDraft(current, submitted, true));
      submittedDraft.current = undefined;
      onTaskChange();
    },
  });
  const busy = agent.status === "submitted" || agent.status === "streaming";
  const resuming = agent.status === "resuming";
  const error = localError ?? agent.error?.message;
  // Any browser action since the user's latest message means this turn is browsing.
  const turnStart = agent.data.messages.findLastIndex((message) => message.role === "user");
  const browsing =
    busy &&
    agent.data.messages
      .slice(turnStart + 1)
      .some((message) =>
        message.parts.some((part) => part.type === "dynamic-tool" && part.toolName === "browser"),
      );
  useEffect(() => onBrowsingChange?.(browsing), [browsing, onBrowsingChange]);

  async function send(text: string) {
    if (!text.trim() || busy || resuming) return;
    setLocalError(undefined);
    submittedDraft.current = { text, accepted: false };
    setInput("");
    try {
      await agent.send(text.trim());
    } catch (cause) {
      submittedDraft.current = undefined;
      setInput((current) => current || text);
      setLocalError(errorMessage(cause));
    }
  }

  async function answerRequest(
    request: EveMessageInputRequest,
    optionId?: string,
  ) {
    if (busy || resuming || respondingTo) return;
    const text = answers[request.requestId]?.trim();
    if (!optionId && !text) return;
    setRespondingTo(request.requestId);
    setLocalError(undefined);
    try {
      if (optionId)
        await agent.respond([{ requestId: request.requestId, optionId }]);
      else if (text)
        await agent.respond([{ requestId: request.requestId, text }]);
    } catch (cause) {
      setLocalError(errorMessage(cause));
    } finally {
      setRespondingTo(undefined);
    }
  }

  return (
    <section
      aria-label="Assistant conversation"
      className="flex h-full min-h-96 flex-col"
    >
      <div className="flex shrink-0 items-center gap-2 border-b py-2 pr-2 pl-4">
        <h2 className="sr-only">Personal assistant</h2>
        <p aria-live="polite" className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {resuming
            ? "Restoring conversation…"
            : busy
              ? "Working on your request…"
              : "Ready when you are"}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <ModelPicker disabled={busy || resuming} />
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || resuming}
            onClick={() => {
              agent.reset();
              submittedDraft.current = undefined;
              setInput("");
              setAnswers({});
              setLocalError(undefined);
            }}
          >
            <PlusIcon data-icon="inline-start" />
            New chat
          </Button>
        </div>
      </div>

      <Conversation
        className="min-h-0 flex-1"
        initial="instant"
        resize="instant"
      >
        <ConversationContent className="gap-6 p-5 sm:p-8">
          {agent.data.messages.length === 0 && !resuming && (
            <div className="mx-auto flex w-full max-w-lg flex-col gap-4 py-6 sm:py-8">
              <div className="flex flex-col gap-2">
                <h3 className="text-xl font-medium tracking-tight sm:text-2xl">
                  What should I take care of?
                </h3>
                <p className="text-sm leading-6 text-muted-foreground">
                  Ask for a meeting brief, an event draft, or tickets found on the web.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  [
                    "Prepare for tomorrow",
                    "Check my Google Calendar and prepare me for my next meeting. Start a live calendar task.",
                  ],
                  [
                    "Find tickets",
                    "Find two tickets for a Toronto Raptors home game next month and show me the three cheapest options with links. Stop before checkout.",
                  ],
                  [
                    "Draft a calendar event",
                    "Find a free 30-minute slot tomorrow afternoon and propose a private event titled 'Focus time' in my primary calendar. Leave the exact draft waiting for my approval in the task inbox.",
                  ],
                  [
                    "Try the teaching demo",
                    "Start a synthetic meeting-prep rehearsal with a manual start and an approval checkpoint.",
                  ],
                ].map(([label, prompt]) => (
                  <Button
                    className="h-auto justify-between whitespace-normal rounded-sm border px-4 py-3 text-left font-normal"
                    key={label}
                    onClick={() => void send(prompt)}
                    variant="ghost"
                  >
                    {label}
                    <ArrowUpIcon aria-hidden="true" data-icon="inline-end" />
                  </Button>
                ))}
              </div>
            </div>
          )}
          {agent.data.messages.map((message) => (
            <Message from={message.role} key={message.id}>
              <p className="text-xs font-medium text-muted-foreground">
                {message.role === "user" ? "You" : "Assistant"}
              </p>
              <MessageContent>
                {message.parts.map((part, index) => {
                  if (part.type === "text")
                    return (
                      <MessageResponse key={index} isAnimating={busy}>
                        {part.text}
                      </MessageResponse>
                    );
                  if (part.type !== "dynamic-tool") return null;
                  const request =
                    part.state === "approval-requested"
                      ? part.toolMetadata?.eve?.inputRequest
                      : undefined;
                  const requestControl = request && (
                    <AssistantInputRequest
                      request={request}
                      prompt={
                        part.toolName === "browser" && request.kind === "tool-approval"
                          ? "Open your cloud browser for this conversation? Chrome runs in an isolated sandbox that you can watch beside the chat. The assistant only browses; it never signs in, pays, or books."
                          : undefined
                      }
                      disabled={busy || resuming || Boolean(respondingTo)}
                      answer={answers[request.requestId] ?? ""}
                      onAnswerChange={(value) =>
                        setAnswers((current) => ({ ...current, [request.requestId]: value }))
                      }
                      onRespond={(optionId) => void answerRequest(request, optionId)}
                    />
                  );
                  if (part.toolName === "browser")
                    return (
                      <div className="flex flex-col gap-2" key={index}>
                        <BrowserActionRow
                          input={part.input as Partial<BrowserInput> | undefined}
                          output={part.state === "output-available" ? (part.output as BrowserResult) : undefined}
                          state={part.state}
                        />
                        {requestControl}
                      </div>
                    );
                  const tool = toolLabel(part.toolName);
                  return (
                    <div className="flex flex-col gap-2" key={index}>
                      {part.state === "output-available" &&
                      part.output !== undefined ? (
                        <Collapsible>
                          <CollapsibleTrigger className="group flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                            <CheckIcon aria-hidden="true" className="size-3.5" />
                            {tool}
                            <ChevronDownIcon
                              aria-hidden="true"
                              className="size-3 transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none"
                            />
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-muted/50 p-2 font-mono text-xs leading-5">
                              {JSON.stringify(part.output, null, 2)}
                            </pre>
                          </CollapsibleContent>
                        </Collapsible>
                      ) : (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <WrenchIcon aria-hidden="true" className="size-3.5" />
                          {tool} · {part.state.replaceAll("-", " ")}
                        </p>
                      )}
                      {part.state === "output-error" && (
                        <p className="text-xs text-destructive">
                          {part.errorText}
                        </p>
                      )}
                      {requestControl}
                    </div>
                  );
                })}
              </MessageContent>
            </Message>
          ))}
          {(busy || resuming) && (
            <p
              className="flex items-center gap-2 text-xs text-muted-foreground"
              role="status"
            >
              <LoaderCircleIcon
                className="size-3.5 motion-safe:animate-spin"
                aria-hidden="true"
              />
              {resuming
                ? "Replaying saved activity"
                : "Following the agent’s progress"}
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Couldn’t complete this request</AlertTitle>
              <AlertDescription>
                <p>{error}</p>
                {agent.session ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setLocalError(undefined);
                      void agent
                        .resume()
                        .catch((cause) => setLocalError(errorMessage(cause)));
                    }}
                  >
                    Reconnect conversation
                  </Button>
                ) : (
                  <p>
                    Check your access settings, then send your message again.
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}
        </ConversationContent>
        <ConversationScrollButton aria-label="Scroll to latest message" />
      </Conversation>

      <form
        className="flex shrink-0 flex-col gap-3 border-t bg-background p-4 sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <label className="sr-only" htmlFor="assistant-message">
          Message your assistant
        </label>
        <div className="flex items-end gap-2 rounded-lg border bg-background p-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          <Textarea
            className="min-h-16 resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0"
            disabled={resuming}
            id="assistant-message"
            maxLength={4000}
            placeholder="What would you like taken care of?"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send(input);
              }
            }}
          />
          {busy ? (
            <Button
              aria-label="Stop agent response"
              variant="outline"
              size="icon"
              type="button"
              onClick={() => {
                void agent
                  .cancel()
                  .catch((cause) => setLocalError(errorMessage(cause)));
              }}
            >
              <CircleStopIcon />
            </Button>
          ) : (
            <Button
              aria-label="Send message"
              size="icon"
              type="submit"
              disabled={!input.trim() || resuming}
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Calendar writes need your approval.
        </p>
      </form>
    </section>
  );
}
