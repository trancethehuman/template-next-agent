import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "bun:test";
import { assertCompatibleLocalWorkflowDataDirectory } from "../../lib/workflow/local-data";

function withTemporaryDirectory(check: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "workflow-local-data-test-"));
  try {
    check(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function snapshotDirectory(directory: string): Record<string, Buffer | null> {
  const snapshot: Record<string, Buffer | null> = {};
  function visit(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const key = relative(directory, path);
      snapshot[key] = entry.isDirectory() ? null : readFileSync(path);
      if (entry.isDirectory()) visit(path);
    }
  }
  visit(directory);
  return snapshot;
}

test("a missing local data directory is accepted without creating it", () => {
  withTemporaryDirectory((parent) => {
    const directory = join(parent, "not-created");
    assertCompatibleLocalWorkflowDataDirectory(directory);
    assert.equal(existsSync(directory), false);
    assert.deepEqual(readdirSync(parent), []);
  });
});

test("an empty local data directory is accepted without initialization", () => {
  withTemporaryDirectory((directory) => {
    assertCompatibleLocalWorkflowDataDirectory(directory);
    assert.deepEqual(readdirSync(directory), []);
  });
});

test("current per-run storage and a separate legacy EVE store are left intact", () => {
  withTemporaryDirectory((parent) => {
    const directory = join(parent, "application-store");
    const runId = "wrun_SYNTHETIC1";
    for (const entity of ["events", "steps"]) {
      const runDirectory = join(directory, entity, runId);
      mkdirSync(runDirectory, { recursive: true });
      writeFileSync(join(runDirectory, "synthetic.json"), "synthetic current data\n");
    }
    writeFileSync(join(directory, "queue-auth-key"), Buffer.from([0, 1, 2, 255]));
    const eveDirectory = join(parent, ".eve", ".workflow-data", "events");
    mkdirSync(eveDirectory, { recursive: true });
    writeFileSync(join(eveDirectory, `${runId}-evnt_SYNTHETIC.json`), "EVE data\n");
    const before = snapshotDirectory(parent);

    assertCompatibleLocalWorkflowDataDirectory(directory);

    assert.deepEqual(snapshotDirectory(parent), before);
  });
});

for (const entity of ["events", "steps"]) {
  test(`legacy flat ${entity} are rejected without changing any files`, () => {
    withTemporaryDirectory((directory) => {
      mkdirSync(join(directory, entity));
      writeFileSync(
        join(directory, entity, "wrun_SYNTHETIC1-entity_SYNTHETIC.fixture.json"),
        Buffer.from([0, 255, 123, 10, 125]),
      );
      writeFileSync(join(directory, "queue-auth-key"), "synthetic-queue-key\n");
      writeFileSync(join(directory, "version.txt"), "@workflow/world-local@5.0.0-beta.46\n");
      const before = snapshotDirectory(directory);

      assert.throws(
        () => assertCompatibleLocalWorkflowDataDirectory(directory),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(directory));
          assert.match(error.message, /Stop the old server/);
          assert.match(error.message, /archive.*outside the active directory/);
          assert.match(error.message, /fresh WORKFLOW_LOCAL_DATA_DIR/);
          assert.match(error.message, /No files have been changed/);
          return true;
        },
      );
      assert.deepEqual(snapshotDirectory(directory), before);
    });
  });
}

test("non-JSON files in entity directories are accepted unchanged", () => {
  withTemporaryDirectory((directory) => {
    for (const entity of ["events", "steps"]) {
      mkdirSync(join(directory, entity));
      writeFileSync(join(directory, entity, "wrun_SYNTHETIC1-entity.tmp"), "temporary\n");
      writeFileSync(join(directory, entity, ".DS_Store"), Buffer.from([0, 254]));
    }
    const before = snapshotDirectory(directory);

    assertCompatibleLocalWorkflowDataDirectory(directory);

    assert.deepEqual(snapshotDirectory(directory), before);
  });
});

function importNextConfig(
  directory: string,
  overrides: Record<string, string>,
): { accepted: boolean; message?: string; adapters: string[] } {
  const environment = { ...process.env };
  delete environment.VERCEL;
  delete environment.VERCEL_DEPLOYMENT_ID;
  delete environment.WORKFLOW_TARGET_WORLD;
  Object.assign(environment, overrides, { WORKFLOW_LOCAL_DATA_DIR: directory });
  const source = `
    import { mock } from "bun:test";
    const adapters = [];
    mock.module("eve/next", () => ({
      withEve(config) { adapters.push("eve"); return async () => config; },
    }));
    mock.module("workflow/next", () => ({
      withWorkflow(config) { adapters.push("workflow"); return config; },
    }));
    try {
      await import("./next.config.ts");
      console.log(JSON.stringify({ accepted: true, adapters }));
    } catch (error) {
      console.log(JSON.stringify({ accepted: false, message: error.message, adapters }));
    }
  `;
  const result = Bun.spawnSync([process.execPath, "-e", source], {
    cwd: resolve(import.meta.dir, "../.."),
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.equal(result.exitCode, 0, new TextDecoder().decode(result.stderr));
  return JSON.parse(new TextDecoder().decode(result.stdout));
}

const configCases: Array<{
  name: string;
  environment: Record<string, string>;
  refuse: boolean;
}> = [
  {
    name: "a pulled VERCEL flag without a deployment ID still protects local data",
    environment: { VERCEL: "1" },
    refuse: true,
  },
  {
    name: "the explicit world-local package protects local data",
    environment: { WORKFLOW_TARGET_WORLD: "@workflow/world-local" },
    refuse: true,
  },
  {
    name: "an explicit local target protects data even with deployment flags",
    environment: {
      VERCEL: "1",
      VERCEL_DEPLOYMENT_ID: "dpl_SYNTHETIC",
      WORKFLOW_TARGET_WORLD: "local",
    },
    refuse: true,
  },
  {
    name: "the managed Vercel default leaves local data alone",
    environment: { VERCEL: "1", VERCEL_DEPLOYMENT_ID: "dpl_SYNTHETIC" },
    refuse: false,
  },
  {
    name: "a custom nonlocal World leaves local data alone",
    environment: { WORKFLOW_TARGET_WORLD: "@synthetic/workflow-world" },
    refuse: false,
  },
];

for (const configCase of configCases) {
  test(
    `next.config: ${configCase.name}`,
    () => {
      withTemporaryDirectory((directory) => {
        mkdirSync(join(directory, "events"));
        writeFileSync(
          join(directory, "events", "wrun_SYNTHETIC1-evnt_SYNTHETIC.json"),
          Buffer.from([0, 254, 255, 10]),
        );
        writeFileSync(join(directory, "queue-auth-key"), "synthetic-queue-key\n");
        const before = snapshotDirectory(directory);

        const result = importNextConfig(directory, configCase.environment);

        assert.equal(result.accepted, !configCase.refuse);
        assert.deepEqual(result.adapters, configCase.refuse ? [] : ["eve", "workflow"]);
        if (configCase.refuse) {
          assert.ok(result.message);
          assert.ok(result.message.includes(directory));
          assert.match(result.message, /No files have been changed/);
        }
        assert.deepEqual(snapshotDirectory(directory), before);
      });
    },
    30_000,
  );
}
