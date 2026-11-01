import { expect, test } from "bun:test";

test("verified actors cannot read, control, stream, list, or change another user's task state", () => {
  const result = Bun.spawnSync(
    [process.execPath, "tests/fixtures/assistant-isolation.ts"],
    { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0)
    throw new Error(new TextDecoder().decode(result.stderr));
  const evidence = JSON.parse(new TextDecoder().decode(result.stdout));
  expect(evidence).toMatchObject({
    crossUserReadControlStream: "denied",
    legacyUnowned: "denied",
    ownedHistoryPagination: "passed",
    idempotency: "actor-scoped",
    caps: "actor-scoped",
    preferences: "isolated",
    forgedIdentity: "denied",
    boundedScan: "fails-explicitly",
    ownerDecisions: "cookie-only",
  });
});

test("legacy background task inputs cannot claim a new user or reach calendar execution", () => {
  const code = `
    import {mock} from "bun:test";
    let hooks=0;
    mock.module("workflow",()=>({FatalError:class extends Error{},createHook(){hooks++;throw new Error("Legacy tasks must not register a new hook")},getStepMetadata(){throw new Error("No step allowed")},getWritable(){throw new Error("No stream allowed")},sleep(){throw new Error("No work allowed")}}));
    const {assistantTaskWorkflow}=await import("./workflows/assistant-task.ts");
    let message;try{await assistantTaskWorkflow({taskId:"synthetic-legacy",mode:"calendar"})}catch(error){message=error.message}
    console.log(JSON.stringify({hooks,message}));
  `;
  const result = Bun.spawnSync([process.execPath, "-e", code], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(new TextDecoder().decode(result.stderr));
  const evidence = JSON.parse(new TextDecoder().decode(result.stdout));
  expect(evidence.hooks).toBe(0);
  expect(evidence.message).toContain(
    "without an authenticated owner cannot run",
  );
});
