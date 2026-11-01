import type { AssistantMode } from "./types";

/** Guided execution must not inherit hidden automatic-mode form values. */
export function taskExecutionSettings(
  mode: AssistantMode,
  demoMode: boolean,
  settings: { delay: string; manualStart: boolean; approvalRequired: boolean },
) {
  return mode === "rehearsal" && demoMode
    ? { delaySeconds: 0, manualStart: false, approvalRequired: true }
    : {
      delaySeconds: Number(settings.delay),
      manualStart: settings.manualStart,
      approvalRequired: settings.approvalRequired,
    };
}
