import { promises as fsPromises } from "node:fs";

const defaultStaleAfterMs = 900_000;

export const progressContract = {
  defaultStaleAfterMs,
  statuses: ["queued", "running", "blocked", "completed", "failed"],
  terminalStatuses: ["completed", "failed"],
  version: 1,
} as const;

export type ProgressStatus = (typeof progressContract.statuses)[number];
export const progressStatuses = progressContract.statuses;
export const defaultProgressStaleAfterMs = progressContract.defaultStaleAfterMs;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isProgressStatus = (value: unknown): value is ProgressStatus =>
  typeof value === "string" && progressStatuses.some((status) => status === value);

export type ProgressJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly ProgressJsonValue[]
  | Readonly<{ readonly [key: string]: ProgressJsonValue }>;

export type ProgressEvidence = Readonly<Record<string, ProgressJsonValue>>;

export interface ProgressEvent {
  readonly runId: string;
  readonly agentId: string;
  readonly taskId: string;
  readonly status: ProgressStatus;
  readonly timestamp: string;
  readonly modelTier?: string;
  readonly summary: string;
  readonly blocker?: string;
  readonly evidence?: readonly ProgressEvidence[];
}

export interface ProgressTaskAgentSnapshot {
  readonly agentId: string;
  readonly taskId: string;
  readonly event: ProgressEvent;
  readonly staleHeartbeatAgeMs?: number;
}

export interface StaleHeartbeat {
  readonly agentId: string;
  readonly taskId: string;
  readonly lastEventAt: string;
  readonly ageMs: number;
}

export interface ProgressSnapshot {
  readonly runId: string;
  readonly events: readonly ProgressEvent[];
  readonly taskAgents: readonly ProgressTaskAgentSnapshot[];
  readonly staleHeartbeats: readonly StaleHeartbeat[];
}

export interface ReconcileProgressOptions {
  readonly runId: string;
  readonly now?: string | Date;
  readonly staleAfterMs?: number;
}

export interface ProgressCliIo {
  readonly write: (chunk: string) => boolean;
}

const isJsonValue = (value: unknown): value is ProgressJsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item));
  return isRecord(value) && Object.values(value).every((item) => isJsonValue(item));
};

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isEvidence = (value: unknown): value is ProgressEvidence =>
  isRecord(value) && Object.values(value).every((item) => isJsonValue(item));

const eventError = (line: number | undefined, message: string): Error =>
  new Error(`Invalid progress event${line === undefined ? "" : ` on line ${line}`}: ${message}`);

export const validateProgressEvent = (value: unknown, line?: number): ProgressEvent => {
  if (!isRecord(value)) throw eventError(line, "expected a JSON object.");
  const { runId, agentId, taskId, status, timestamp, modelTier, summary, blocker, evidence } =
    value;
  if (!nonEmptyString(runId)) throw eventError(line, "runId must be a non-empty string.");
  if (!nonEmptyString(agentId)) throw eventError(line, "agentId must be a non-empty string.");
  if (!nonEmptyString(taskId)) throw eventError(line, "taskId must be a non-empty string.");
  if (!isProgressStatus(status))
    throw eventError(line, `status must be one of ${progressStatuses.join(", ")}.`);
  if (!nonEmptyString(timestamp) || !Number.isFinite(Date.parse(timestamp)))
    throw eventError(line, "timestamp must be a valid date string.");
  if (!nonEmptyString(summary)) throw eventError(line, "summary must be a non-empty string.");
  if (modelTier !== undefined && !nonEmptyString(modelTier))
    throw eventError(line, "modelTier must be a non-empty string when provided.");
  if (blocker !== undefined && !nonEmptyString(blocker))
    throw eventError(line, "blocker must be a non-empty string when provided.");
  if (
    evidence !== undefined &&
    (!Array.isArray(evidence) || !evidence.every((item) => isEvidence(item)))
  )
    throw eventError(line, "evidence must be an array of JSON records.");
  return {
    runId,
    agentId,
    taskId,
    status,
    timestamp,
    ...(modelTier === undefined ? {} : { modelTier }),
    summary,
    ...(blocker === undefined ? {} : { blocker }),
    evidence: evidence ?? [],
  };
};

export const appendProgressEvent = async (
  filePath: string,
  progressEvent: unknown,
): Promise<void> => {
  const event = validateProgressEvent(progressEvent);
  await fsPromises.appendFile(filePath, `${JSON.stringify(event)}\n`, {
    encoding: "utf8",
    flag: "a",
  });
};

const parseProgressLine = (line: string, lineNumber: number): unknown => {
  try {
    return JSON.parse(line) as unknown;
  } catch (error) {
    throw eventError(lineNumber, error instanceof Error ? error.message : "invalid JSON.");
  }
};

export const readProgressEvents = async (filePath: string): Promise<readonly ProgressEvent[]> => {
  const source = await fsPromises.readFile(filePath, "utf8");
  return source.split("\n").flatMap((line, index) => {
    if (line.trim().length === 0) return [];
    return [validateProgressEvent(parseProgressLine(line, index + 1), index + 1)];
  });
};

const compareText = (left: string, right: string): number => {
  if (left === right) return 0;
  const orderedBefore = -1;
  const orderedAfter = 1;
  return left < right ? orderedBefore : orderedAfter;
};

export const reconcileProgress = (
  events: readonly ProgressEvent[],
  options: ReconcileProgressOptions,
): ProgressSnapshot => {
  if (!nonEmptyString(options.runId))
    throw new Error("Progress reconciliation runId must be non-empty.");
  if (
    options.staleAfterMs !== undefined &&
    (!Number.isFinite(options.staleAfterMs) || options.staleAfterMs < 0)
  )
    throw new Error("Progress reconciliation staleAfterMs must be a non-negative number.");
  const now = options.now === undefined ? Date.now() : new Date(options.now).getTime();
  if (!Number.isFinite(now)) throw new Error("Progress reconciliation now must be a valid date.");
  const runEvents = events
    .map((event, index) => ({ event: validateProgressEvent(event), index }))
    .filter(({ event }) => event.runId === options.runId);
  const latest = new Map<string, { readonly event: ProgressEvent; readonly index: number }>();
  for (const candidate of runEvents) {
    const key = JSON.stringify([candidate.event.agentId, candidate.event.taskId]);
    const current = latest.get(key);
    if (
      current === undefined ||
      Date.parse(candidate.event.timestamp) > Date.parse(current.event.timestamp) ||
      (Date.parse(candidate.event.timestamp) === Date.parse(current.event.timestamp) &&
        candidate.index > current.index)
    )
      latest.set(key, candidate);
  }
  const taskAgents = [...latest.values()]
    .toSorted(
      (left, right) =>
        compareText(left.event.agentId, right.event.agentId) ||
        compareText(left.event.taskId, right.event.taskId),
    )
    .map(({ event }): ProgressTaskAgentSnapshot => {
      const ageMs = Math.max(0, now - Date.parse(event.timestamp));
      const stale =
        options.staleAfterMs !== undefined &&
        ageMs >= options.staleAfterMs &&
        !progressContract.terminalStatuses.some((status) => status === event.status);
      const snapshot: ProgressTaskAgentSnapshot = {
        agentId: event.agentId,
        taskId: event.taskId,
        event,
      };
      if (stale) return Object.assign(snapshot, { staleHeartbeatAgeMs: ageMs });
      return snapshot;
    });
  return {
    runId: options.runId,
    events: runEvents.map(({ event }) => event),
    taskAgents,
    staleHeartbeats: taskAgents.flatMap((entry) =>
      entry.staleHeartbeatAgeMs === undefined
        ? []
        : [
            {
              agentId: entry.agentId,
              taskId: entry.taskId,
              lastEventAt: entry.event.timestamp,
              ageMs: entry.staleHeartbeatAgeMs,
            },
          ],
    ),
  };
};

export const readProgressSnapshot = async (
  filePath: string,
  options: ReconcileProgressOptions,
): Promise<ProgressSnapshot> => reconcileProgress(await readProgressEvents(filePath), options);

const cliUsage =
  "Usage: bun scripts/agent-progress.ts <append|read|snapshot> <file> [event-json|run-id] [stale-ms] [now]";

const cliArgument = (value: string | undefined, name: string): string => {
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required.\n${cliUsage}`);
  return value;
};

const cliNumber = (value: string, name: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`${name} must be a non-negative number.`);
  return parsed;
};

const writeJson = (io: ProgressCliIo, value: unknown): void => {
  io.write(`${JSON.stringify(value)}\n`);
};

const stdoutIo = (): ProgressCliIo => ({
  write: (chunk: string): boolean => process.stdout.write(chunk),
});

export const runProgressCli = async (
  args: readonly string[],
  io: ProgressCliIo = stdoutIo(),
): Promise<void> => {
  const [command, filePath, value, staleAfterMsValue, nowValue] = args;
  if (command === "append") {
    const eventValue = cliArgument(value, "event JSON");
    await appendProgressEvent(
      cliArgument(filePath, "file path"),
      JSON.parse(eventValue) as unknown,
    );
    writeJson(io, { ok: true });
    return;
  }
  const ledgerPath = cliArgument(filePath, "file path");
  if (command === "read") {
    writeJson(io, await readProgressEvents(ledgerPath));
    return;
  }
  if (command !== "snapshot")
    throw new Error(`Unknown command ${command ?? "(missing)"}.\n${cliUsage}`);

  const options = {
    runId: cliArgument(value, "run ID"),
    ...(staleAfterMsValue === undefined
      ? {}
      : { staleAfterMs: cliNumber(staleAfterMsValue, "staleAfterMs") }),
    ...(nowValue === undefined ? {} : { now: nowValue }),
  } satisfies ReconcileProgressOptions;
  writeJson(io, await readProgressSnapshot(ledgerPath, options));
};

if (import.meta.main)
  await runProgressCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
