import type { ClassificationRow } from "@/lib/transactions/types";
import { rowStatusLabel } from "./row-steps";

export function executionStatusLabel(
  row: ClassificationRow,
  run?: { state: string; runId?: string },
): string {
  if (!run) return "Ready";
  if (run.state === "failed" && !run.runId) return "Not started";
  return rowStatusLabel(row.status);
}
