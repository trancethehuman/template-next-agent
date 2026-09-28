import type { NextConfig } from "next";
import { withEve } from "eve/next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
};

const eveConfig = withEve(nextConfig);

export default withWorkflow(async (phase, context) => eveConfig(phase, context));
