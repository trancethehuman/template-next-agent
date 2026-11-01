import type { NextConfig } from "next";
import { resolve } from "node:path";
import { withEve } from "eve/next";
import { withWorkflow } from "workflow/next";

// The pinned Next adapter otherwise stores Local World records under .next,
// which next build clears. Select the local World before invoking the adapter
// so its fallback cannot overwrite this persistent path. EVE explicitly owns
// its separate .eve/.workflow-data directory and queue.
if (!process.env.VERCEL && !process.env.VERCEL_DEPLOYMENT_ID) {
  process.env.WORKFLOW_TARGET_WORLD ||= "local";
  if (process.env.WORKFLOW_TARGET_WORLD === "local") {
    process.env.WORKFLOW_LOCAL_DATA_DIR = resolve(
      process.cwd(),
      process.env.WORKFLOW_LOCAL_DATA_DIR || ".workflow-data",
    );
  }
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  logging: {
    incomingRequests: {
      // OAuth callbacks carry one-time codes; keep their query out of dev logs.
      ignore: [/\/api\/auth\//, /\/api\/assistant\/calendar\/return/],
    },
  },
};

const eveConfig = withEve(nextConfig);

export default withWorkflow(async (phase, context) =>
  eveConfig(phase, context),
);
