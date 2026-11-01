import {
  CalendarDaysIcon,
  InboxIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AssistantSignInButton } from "./assistant-sign-in-button";

export function AssistantLogin({
  configured,
  error,
  onSignIn,
  workspaceDomain,
  workspaceName,
}: {
  configured: boolean;
  error?: string;
  onSignIn: () => Promise<void>;
  workspaceDomain?: string;
  workspaceName?: string;
}) {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8 py-8 sm:py-16 lg:grid-cols-2 lg:gap-16">
      <section className="flex flex-col gap-6 lg:col-start-1 lg:row-start-1">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          <SparklesIcon className="size-4" aria-hidden="true" />
          Always-on assistant
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Your assistant.
          <br />
          Your workspace.
        </h1>
        <p className="max-w-md text-base leading-7 text-muted-foreground">
          Hand off the work. Follow its progress. Come back to the outcome.
        </p>
      </section>
      <section
        className="flex h-fit flex-col gap-6 rounded-lg border bg-card p-6 sm:p-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-10"
        aria-labelledby="assistant-sign-in-title"
      >
        <Badge variant="secondary" className="w-fit">
          {workspaceName ? `${workspaceName} workspace` : "Google sign-in"}
        </Badge>
        <div className="flex flex-col gap-2">
          <h2
            id="assistant-sign-in-title"
            className="text-xl font-semibold tracking-tight"
          >
            Sign in to your assistant
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {workspaceDomain
              ? `Use a Google Workspace account from ${workspaceDomain}. Other accounts can’t access this workspace.`
              : "Use your Google account to open your personal assistant workspace."}
          </p>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Sign-in wasn’t completed</AlertTitle>
            <AlertDescription>
              {error === "AccessDenied"
                ? workspaceDomain
                  ? `Use a verified Google Workspace account from ${workspaceDomain} to continue.`
                  : "Use a verified Google account to continue."
                : "We couldn’t finish signing you in. Try again."}
            </AlertDescription>
          </Alert>
        )}
        {configured ? (
          <form action={onSignIn}>
            <AssistantSignInButton />
          </form>
        ) : (
          <Alert>
            <AlertTitle>Google sign-in needs setup</AlertTitle>
            <AlertDescription>
              The workspace owner needs to finish Google sign-in configuration
              before you can continue.
            </AlertDescription>
          </Alert>
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          Signing in identifies your workspace. You choose whether to connect
          Google Calendar afterward. Every proposed calendar change waits for
          your approval.
        </p>
      </section>
      <section
        aria-label="How your assistant works"
        className="flex flex-col gap-5 border-t pt-6 lg:col-start-1 lg:row-start-2"
      >
        {[
          {
            icon: CalendarDaysIcon,
            title: "Connect your calendar",
            description:
              "Find time, prepare for meetings, and draft events for your approval.",
          },
          {
            icon: InboxIcon,
            title: "See work in motion",
            description:
              "Open a task to inspect, pause, resume, or stop its durable workflow.",
          },
          {
            icon: ShieldCheckIcon,
            title: "Keep your work separate",
            description:
              "Your calendar, conversations, and tasks belong to your signed-in account.",
          },
        ].map((item) => (
          <div className="flex gap-3" key={item.title}>
            <item.icon
              className="mt-1 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <h2 className="text-sm font-medium">{item.title}</h2>
              <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                {item.description}
              </p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
