# Guided workflow verification

Use Node.js 24 and Bun. The deterministic suite needs no Calendar connection or model credential:

```bash
bun test tests/backend/assistant-demonstration.test.ts
```

The fixture runs each scenario in a fresh Bun process. It executes the real assistant workflow branch and the real fictional source and preparation functions. Only the Workflow transport, timers, and provider boundary are doubled. This verifies orchestration; it does not prove SDK persistence on its own.

The scenarios cover:

- One-phase advance, with no source read or brief emitted before its gate.
- One-second playback pacing, pause before a timer, and a delayed pause after the timer advances to another gate.
- Rejection of forged pause checkpoint identities.
- Play to a chosen stage running the stages before it, pausing before that stage runs, and the stop being spent once it pauses.
- Playback stopping for an explicit owner approval; denial emits no inbox update.
- Replay suppressing an unchanged source, monitoring pause/resume, and a version-two source producing a new brief and update.
- Restored delivery requiring a fresh approval, without presenting copied context as newly generated output.
- `maxChecks` preventing a fourth read, including after old timers resolve.
- A restarted calendar proposal waiting for a fresh approval and retaining the original provider action identity. Its provider is a test double; this scenario performs no Google write.
- A restored live meeting brief preserving its full source fingerprint through the real restart planner and ordinary workflow branch. A fresh approval delivers once; the next unchanged Calendar fixture read is deduplicated with no model call, new brief, or second approval.

For the actual local Next.js and Workflow runtime, start the application normally, then explicitly opt in:

```bash
ASSISTANT_DEMONSTRATION_HTTP=1 bun --env-file=.env.local test tests/backend/assistant-demonstration.test.ts
```

The HTTP test is limited to an HTTP loopback address. `ASSISTANT_DEMONSTRATION_BASE_URL` can select a different local port; it defaults to `http://localhost:3000`. It signs a short-lived synthetic session cookie in memory using the local `AUTH_SECRET`, so it tests the authenticated API and Workflow runtime without running Google OAuth. It creates a random fixture principal, uses fictional rehearsal data exclusively, and never logs the cookie or configured credentials.

The actual flow advances one read, pauses playback, waits beyond the pending durable timer, resumes to the owner decision, delivers one approved inbox update, and enters monitoring. It then restarts a historical source checkpoint, retries the restart request to verify idempotency, checks the old history is unchanged and its run stopped, and declines the replacement run's fresh review. Cleanup is restricted to this fixture principal's exact newly created run IDs. The user's rehearsals and other actors' tasks are untouched.

The live test leaves terminal synthetic history in the ignored `.workflow-data` directory. It does not clear storage. Ordinary test runs skip the HTTP case. Server process restart persistence needs a separately coordinated stop/start check; reopening a checkpoint through HTTP is not proof of process restart recovery.

On October 30, 2026, the opt-in HTTP case passed against the development server, and the isolated fixture suite passed. Focused lint and TypeScript checks passed. Google OAuth and real provider read/write verification are documented separately in [ASSISTANT-CALENDAR.md](ASSISTANT-CALENDAR.md).

Final acceptance on October 30, 2026: the complete suite passed all 189 tests with real HTTP/Workflow acceptance enabled. EVE and Next production builds, lint, design lint, typecheck, and whitespace checks passed. The business-account browser demonstrated one-click creation, one-stage advance, Play stopping for review, source and preparation restarts, separate approval/delivery, and reset from beginning. The same guided run survived both builds and server shutdown/restart, retained its run ID and pending read gate, and successfully advanced afterward. The original queued classroom rehearsal remained untouched. Mobile controls fit the tested 390-pixel viewport without horizontal overflow. Only synthetic rehearsal work was executed in the new browser acceptance; no Google event was created.
