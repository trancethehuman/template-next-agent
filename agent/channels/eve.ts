import { eveChannel } from "eve/channels/eve";
import { defineChannel } from "eve/channels";
import type { AuthFn } from "eve/channels/auth";
import { assistantGoogleAuth } from "../lib/auth";

export function createAssistantChannel(auth: AuthFn<Request> = assistantGoogleAuth()) {
  const channel = eveChannel({ auth, uploadPolicy: "disabled" });
  // Callback, delegated-input and subagent routes must not bypass the verified
  // cookie + immutable session-owner check on the browser session surface.
  return defineChannel({
    routes: channel.routes.filter((route) =>
      /^\/eve\/v1\/(?:health|info|session(?:\/:sessionId(?:\/(?:stream|cancel|compact|clear|reset))?)?)$/.test(route.path),
    ),
  });
}

export default createAssistantChannel();
