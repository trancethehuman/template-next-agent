"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { useDefaultLayout, type LayoutStorage } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";

/** Side by side from Tailwind's lg breakpoint; stacked below it. */
const sideBySide = "(min-width: 64rem)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(sideBySide);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** The split is a per-viewer convenience; blocked storage falls back to the default split. */
const savedSplit: LayoutStorage = {
  getItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* The split still works; it just is not remembered. */
    }
  },
};

/**
 * The chat beside a side panel, here the cloud browser. On wide screens the
 * divider drags to make the live view bigger, remembers where it was left,
 * and resets on double-click. Narrow screens stack the two.
 */
export function ChatSplit({ chat, side }: { chat: ReactNode; side: ReactNode }) {
  // Null while hydrating, so the browser's live view mounts once, in its final place.
  const wide = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(sideBySide).matches,
    () => null,
  );
  // Saves every change, including a double-click reset; it stores the requested
  // split, so a narrow window does not overwrite the size someone chose.
  const layout = useDefaultLayout({ id: "assistant-chat-side", storage: savedSplit });

  if (wide === null) return <Skeleton className="assistant-conversation-frame w-full" />;

  if (!wide)
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <div className="assistant-conversation-frame min-w-0 overflow-hidden rounded-lg border">
          {chat}
        </div>
        {side}
      </div>
    );

  return (
    <div className="assistant-conversation-frame">
      <ResizablePanelGroup
        id="assistant-chat-side"
        orientation="horizontal"
        defaultLayout={layout.defaultLayout}
        onLayoutChanged={layout.onLayoutChanged}
      >
        <ResizablePanel id="chat" defaultSize="64" minSize={360}>
          <div className="h-full min-w-0 overflow-hidden rounded-lg border">{chat}</div>
        </ResizablePanel>
        <ResizableHandle
          withHandle
          aria-label="Resize the chat and the browser"
          className="mx-1.5 bg-transparent"
        />
        <ResizablePanel id="side" defaultSize="36" minSize={280} maxSize="72">
          <aside className="flex h-full min-w-0 flex-col gap-3 overflow-y-auto">{side}</aside>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
