import assert from "node:assert/strict";
import { promises as fsPromises } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  appendProgressEvent,
  defaultProgressStaleAfterMs,
  progressStatuses as runtimeProgressStatuses,
  readProgressEvents,
  readProgressSnapshot,
  reconcileProgress,
  runProgressCli,
  validateProgressEvent,
} from "./agent-progress";
import type { ProgressEvent } from "./agent-progress";

const expectedRunEventCount = 3;
const staleAfterMs =
  Date.parse("2026-09-01T12:00:00.000Z") - Date.parse("2026-09-01T11:30:00.000Z");
const expectedStaleAgeMs =
  Date.parse("2026-09-01T12:00:00.000Z") - Date.parse("2026-09-01T11:00:00.000Z");
const concurrentEventCount = 16;

const event = (overrides: Partial<ProgressEvent> = {}): ProgressEvent => ({
  runId: "run-1",
  agentId: "agent-1",
  taskId: "task-1",
  status: "running",
  timestamp: "2026-09-01T12:00:00.000Z",
  summary: "Working on the task.",
  evidence: [],
  ...overrides,
});

void test("appendProgressEvent writes one JSON Lines event and readProgressEvents reads it", async () => {
  const directory = await fsPromises.mkdtemp(path.join(tmpdir(), "x2zod-progress-"));
  const filePath = path.join(directory, "progress.jsonl");

  try {
    await appendProgressEvent(filePath, event({ modelTier: "fast" }));

    assert.deepEqual(await readProgressEvents(filePath), [event({ modelTier: "fast" })]);
    const contents = await fsPromises.readFile(filePath, "utf8");
    assert.equal(contents.split("\n").filter(Boolean).length, 1);
  } finally {
    await fsPromises.rm(directory, { recursive: true, force: true });
  }
});

void test("appendProgressEvent does not persist unknown prompt or reasoning fields", async () => {
  const directory = await fsPromises.mkdtemp(path.join(tmpdir(), "x2zod-progress-"));
  const filePath = path.join(directory, "progress.jsonl");

  try {
    await appendProgressEvent(filePath, {
      ...event(),
      prompt: "raw prompt must not be persisted",
      reasoning: "raw reasoning must not be persisted",
    });

    const contents = await fsPromises.readFile(filePath, "utf8");
    assert.doesNotMatch(contents, /raw prompt|raw reasoning/u);
  } finally {
    await fsPromises.rm(directory, { recursive: true, force: true });
  }
});

void test("reconcileProgress keeps the latest explicit event per agent and task", () => {
  const snapshot = reconcileProgress(
    [
      event({ status: "completed", timestamp: "2026-09-01T12:03:00.000Z", summary: "Done." }),
      event({
        status: "running",
        timestamp: "2026-09-01T12:02:00.000Z",
        summary: "Still working.",
      }),
      event({ agentId: "agent-2", taskId: "task-1", summary: "Other agent." }),
      event({ runId: "run-2", status: "completed", summary: "Different run." }),
    ],
    { runId: "run-1", now: "2026-09-01T12:04:00.000Z" },
  );

  const [first, second] = snapshot.taskAgents;
  if (first === undefined || second === undefined) throw new Error("Expected two task agents.");
  assert.equal(snapshot.taskAgents.length, 2);
  assert.equal(first.event.status, "completed");
  assert.equal(first.event.summary, "Done.");
  assert.equal(second.agentId, "agent-2");
  assert.equal(snapshot.events.length, expectedRunEventCount);
  assert.equal(first.staleHeartbeatAgeMs, undefined);
});

void test("reconcileProgress uses append order to break equal timestamp ties", () => {
  const snapshot = reconcileProgress(
    [
      event({ summary: "First at this time." }),
      event({ status: "failed", summary: "Last at this time." }),
    ],
    { runId: "run-1", now: "2026-09-01T12:01:00.000Z" },
  );

  const [first] = snapshot.taskAgents;
  if (first === undefined) throw new Error("Expected one task agent.");
  assert.equal(first.event.status, "failed");
  assert.equal(first.event.summary, "Last at this time.");
});

void test("concurrent appends remain independently readable JSON Lines records", async () => {
  const directory = await fsPromises.mkdtemp(path.join(tmpdir(), "x2zod-progress-"));
  const filePath = path.join(directory, "progress.jsonl");

  try {
    await Promise.all(
      Array.from({ length: concurrentEventCount }, async (_value, indexValue) => {
        await appendProgressEvent(
          filePath,
          event({ agentId: `agent-${indexValue}`, summary: `Event ${indexValue}.` }),
        );
      }),
    );

    const events = await readProgressEvents(filePath);
    assert.equal(events.length, concurrentEventCount);
  } finally {
    await fsPromises.rm(directory, { recursive: true, force: true });
  }
});

void test("stale heartbeat age is data and does not fabricate a blocked status", () => {
  const snapshot = reconcileProgress(
    [event({ status: "running", timestamp: "2026-09-01T11:00:00.000Z" })],
    { runId: "run-1", now: "2026-09-01T12:00:00.000Z", staleAfterMs },
  );

  assert.equal(snapshot.taskAgents[0]?.event.status, "running");
  assert.deepEqual(snapshot.staleHeartbeats, [
    {
      agentId: "agent-1",
      taskId: "task-1",
      lastEventAt: "2026-09-01T11:00:00.000Z",
      ageMs: expectedStaleAgeMs,
    },
  ]);
});

void test("uses the executable progress contract and leaves terminal events fresh", () => {
  assert.deepEqual(runtimeProgressStatuses, [
    "queued",
    "running",
    "blocked",
    "completed",
    "failed",
  ]);
  assert.equal(defaultProgressStaleAfterMs, staleAfterMs / 2);

  const snapshot = reconcileProgress(
    [event({ status: "completed", timestamp: "2026-09-01T11:00:00.000Z" })],
    { runId: "run-1", now: "2026-09-01T12:00:00.000Z", staleAfterMs: defaultProgressStaleAfterMs },
  );

  assert.equal(snapshot.taskAgents[0]?.staleHeartbeatAgeMs, undefined);
  assert.deepEqual(snapshot.staleHeartbeats, []);
});

void test("exports the executable event semantics consumed by external monitors", () => {
  assert.deepEqual(
    validateProgressEvent(event({ modelTier: "fast" })),
    event({ modelTier: "fast" }),
  );
  assert.throws(
    () => validateProgressEvent({ ...event(), status: "invented" }),
    /status must be one of queued, running, blocked, completed, failed/u,
  );
});

void test("readProgressSnapshot reconciles events from a caller-provided file", async () => {
  const directory = await fsPromises.mkdtemp(path.join(tmpdir(), "x2zod-progress-"));
  const filePath = path.join(directory, "progress.jsonl");

  try {
    await appendProgressEvent(filePath, event({ status: "completed", summary: "Done." }));
    const snapshot = await readProgressSnapshot(filePath, { runId: "run-1" });
    assert.equal(snapshot.taskAgents[0]?.event.status, "completed");
  } finally {
    await fsPromises.rm(directory, { recursive: true, force: true });
  }
});

void test("runProgressCli emits JSON for append, read, and snapshot commands", async () => {
  const directory = await fsPromises.mkdtemp(path.join(tmpdir(), "x2zod-progress-"));
  const filePath = path.join(directory, "progress.jsonl");
  const output: string[] = [];
  const io = {
    write: (chunk: string): boolean => {
      output.push(chunk);
      return true;
    },
  };
  const serializedEvent = JSON.stringify(event({ status: "completed", summary: "Done." }));

  try {
    await runProgressCli(["append", filePath, serializedEvent], io);
    await runProgressCli(["read", filePath], io);
    await runProgressCli(["snapshot", filePath, "run-1"], io);

    assert.deepEqual(JSON.parse(output[0] ?? "{}"), { ok: true });
    assert.match(output[1] ?? "", /"status":"completed"/u);
    assert.match(output[2] ?? "", /"status":"completed"/u);
  } finally {
    await fsPromises.rm(directory, { recursive: true, force: true });
  }
});
