"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import type { Session } from "next-auth";
import { SessionProvider, useSession } from "next-auth/react";

function OwnedWorkspace({
  actorId,
  children,
}: {
  actorId: string;
  children: ReactNode;
}) {
  const { data, status } = useSession();
  const changed =
    status === "unauthenticated" ||
    (status === "authenticated" && data.user.id !== actorId);
  useEffect(() => {
    if (changed) window.location.replace("/assistant");
  }, [changed]);
  return changed ? (
    <p role="status" className="py-12 text-sm text-muted-foreground">
      Updating your session…
    </p>
  ) : (
    children
  );
}

/** Auth.js broadcasts sign-out across tabs so an old workspace is removed. */
export function AssistantSessionBoundary({
  session,
  children,
}: {
  session: Session;
  children: ReactNode;
}) {
  return (
    <SessionProvider session={session} refetchOnWindowFocus={false}>
      <OwnedWorkspace actorId={session.user.id}>{children}</OwnedWorkspace>
    </SessionProvider>
  );
}
