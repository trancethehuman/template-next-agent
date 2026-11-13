import { readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join } from "node:path";

const legacyEntityFile = /^wrun_[0-9A-Za-z]+-[^/\\]+\.json$/;

export function assertCompatibleLocalWorkflowDataDirectory(
  directory: string,
): void {
  for (const entityDirectory of ["events", "steps"]) {
    let entries: Dirent[];
    try {
      entries = readdirSync(join(directory, entityDirectory), {
        withFileTypes: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (
      !entries.some(
        (entry) => entry.isFile() && legacyEntityFile.test(entry.name),
      )
    )
      continue;
    throw new Error(
      `Workflow SDK 5 cannot use the legacy local data layout in "${directory}". Stop the old server and archive its data outside the active directory, or choose a fresh WORKFLOW_LOCAL_DATA_DIR. No files have been changed.`,
    );
  }
}
