import { Queue, Worker, type JobsOptions, type Processor, type QueueOptions, type WorkerOptions } from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import { Redis, type RedisOptions } from "ioredis";

export const COHUB_TASKS_QUEUE = "cohub-tasks";
export const COHUB_AGENT_TURNS_QUEUE = "cohub-agent-turns";
export const COHUB_SYSTEM_FS_QUEUE = "cohub-system-fs";

export const DEFAULT_TASK_WORKER_CONCURRENCY = 5;
export const DEFAULT_FS_CDN_WORKER_CONCURRENCY = 4;
export const DEFAULT_AGENT_WORKER_CONCURRENCY = 2;

export const queueDefinitions = [
  {
    name: COHUB_TASKS_QUEUE,
    owner: "worker",
    criticality: "critical",
    concurrencyEnv: "TASK_WORKER_CONCURRENCY",
    defaultConcurrencyPerWorker: DEFAULT_TASK_WORKER_CONCURRENCY,
  },
  {
    name: COHUB_AGENT_TURNS_QUEUE,
    owner: "agent",
    criticality: "critical",
    concurrencyEnv: "AGENT_WORKER_CONCURRENCY",
    defaultConcurrencyPerWorker: DEFAULT_AGENT_WORKER_CONCURRENCY,
  },
  {
    name: COHUB_SYSTEM_FS_QUEUE,
    owner: "system-worker",
    criticality: "normal",
    concurrencyEnv: "FS_CDN_WORKER_CONCURRENCY",
    defaultConcurrencyPerWorker: DEFAULT_FS_CDN_WORKER_CONCURRENCY,
  },
] as const;

export type CohubQueueName = typeof queueDefinitions[number]["name"];
export type QueueDefinition = typeof queueDefinitions[number];

export type QueueParallelism = {
  workers: number;
  configuredConcurrencyPerWorker: number;
  estimatedMaxConcurrency: number;
  source: QueueDefinition["concurrencyEnv"];
};

export const getQueueDefinition = (name: string): QueueDefinition | undefined =>
  queueDefinitions.find((definition) => definition.name === name);

const parsePositiveInteger = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

export const resolveQueueConcurrencyPerWorker = (
  definition: QueueDefinition,
  env: Record<string, string | undefined> = process.env,
) => parsePositiveInteger(env[definition.concurrencyEnv]) ?? definition.defaultConcurrencyPerWorker;

export const resolveQueueConcurrencyPerWorkerByName = (
  queueName: string,
  env?: Record<string, string | undefined>,
) => {
  const definition = getQueueDefinition(queueName);
  if (!definition) throw new Error(`Unknown BullMQ queue: ${queueName}`);
  return resolveQueueConcurrencyPerWorker(definition, env);
};

export const getQueueParallelism = (
  definition: QueueDefinition,
  workers: number,
  env?: Record<string, string | undefined>,
): QueueParallelism => {
  const configuredConcurrencyPerWorker = resolveQueueConcurrencyPerWorker(definition, env);
  return {
    workers,
    configuredConcurrencyPerWorker,
    estimatedMaxConcurrency: workers * configuredConcurrencyPerWorker,
    source: definition.concurrencyEnv,
  };
};

export const defaultJobRetention = {
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 50_000 },
} satisfies Pick<JobsOptions, "removeOnComplete" | "removeOnFail">;

export const defaultCriticalJobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  ...defaultJobRetention,
} satisfies JobsOptions;

export const createQueueTelemetry = (serviceName: string) => new BullMQOtel(serviceName);

export const createBullmqConnectionOptions = (url: string) => ({ url });

export const createBullmqRedisConnection = (url: string, options: RedisOptions = {}) =>
  new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...options,
  });

export function createBullmqQueue<DataType = unknown, ResultType = unknown, NameType extends string = string>(
  queueName: string,
  options: Omit<QueueOptions, "connection" | "telemetry"> & {
    redisUrl: string;
    telemetryServiceName: string;
  },
) {
  const { redisUrl, telemetryServiceName, ...queueOptions } = options;
  return new Queue<DataType, ResultType, NameType>(queueName, {
    ...queueOptions,
    connection: createBullmqConnectionOptions(redisUrl),
    telemetry: createQueueTelemetry(telemetryServiceName),
  });
}

export function createBullmqWorker<DataType = unknown, ResultType = unknown, NameType extends string = string>(
  queueName: string,
  processor: Processor<DataType, ResultType, NameType>,
  options: Omit<WorkerOptions, "connection" | "telemetry"> & {
    redisUrl: string;
    telemetryServiceName: string;
  },
) {
  const { redisUrl, telemetryServiceName, ...workerOptions } = options;
  const connection = createBullmqRedisConnection(redisUrl);
  const worker = new Worker<DataType, ResultType, NameType>(queueName, processor, {
    ...workerOptions,
    connection,
    telemetry: createQueueTelemetry(telemetryServiceName),
  });
  return { worker, connection };
}

export type WorkerLoggerOptions = {
  serviceName: string;
  queueName: string;
  logCompletedResult?: boolean;
  shouldLogCompleted?: (job: { id?: string; name?: string; attemptsMade?: number } | undefined, result: unknown) => boolean;
};

const formatJob = (job: { id?: string; name?: string; attemptsMade?: number } | undefined) =>
  `jobId=${job?.id ?? "unknown"} jobName=${job?.name ?? "unknown"} attemptsMade=${job?.attemptsMade ?? 0}`;

export const attachWorkerEventLogger = (worker: Worker, options: WorkerLoggerOptions) => {
  const prefix = `[${options.serviceName}]`;
  const queue = `queue=${options.queueName}`;

  worker.on("active", (job) => {
    console.log(`${prefix} bullmq.job.active ${queue} ${formatJob(job)}`);
  });

  worker.on("completed", (job, result) => {
    if (options.shouldLogCompleted && !options.shouldLogCompleted(job, result)) return;
    const suffix = options.logCompletedResult ? ` result=${safeJson(redactSensitiveData(result))}` : "";
    console.log(`${prefix} bullmq.job.completed ${queue} ${formatJob(job)}${suffix}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`${prefix} bullmq.job.failed ${queue} ${formatJob(job)} error=${safeJson(redactSensitiveData(error))}`);
  });

  worker.on("stalled", (jobId) => {
    console.error(`${prefix} bullmq.job.stalled ${queue} jobId=${jobId}`);
  });

  worker.on("drained", () => {
    console.log(`${prefix} bullmq.queue.drained ${queue}`);
  });

  worker.on("paused", () => {
    console.log(`${prefix} bullmq.worker.paused ${queue}`);
  });

  worker.on("resumed", () => {
    console.log(`${prefix} bullmq.worker.resumed ${queue}`);
  });

  worker.on("error", (error) => {
    console.error(`${prefix} bullmq.worker.error ${queue} error=${safeJson(redactSensitiveData(error))}`);
  });
};

const safeJson = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify("[unserializable]");
  }
};

export type CloseWorkerGracefullyOptions = {
  serviceName: string;
  timeoutMs: number;
  pauseBeforeClose?: boolean;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const closeWorkerGracefully = async (worker: Worker, options: CloseWorkerGracefullyOptions) => {
  if (options.pauseBeforeClose) {
    await worker.pause(true).catch((error: unknown) => {
      console.error(`[${options.serviceName}] Failed to pause worker before shutdown:`, error);
    });
  }

  const closed = await Promise.race([
    worker.close()
      .then(() => true)
      .catch((error: unknown) => {
        console.error(`[${options.serviceName}] Failed to close worker gracefully:`, safeJson(redactSensitiveData(error)));
        return false;
      }),
    sleep(options.timeoutMs).then(() => false),
  ]);

  if (!closed) {
    console.warn(`[${options.serviceName}] Worker did not close within ${options.timeoutMs}ms, forcing close...`);
    await worker.close(true).catch((error: unknown) => {
      console.error(`[${options.serviceName}] Failed to force-close worker:`, error);
    });
  }
};

export type QueueSnapshot = {
  name: string;
  counts: Awaited<ReturnType<Queue["getJobCounts"]>>;
  isPaused: boolean;
  workers: number;
  oldestWaitingJobAgeMs: number | null;
  parallelism: QueueParallelism | null;
};

export const getQueueSnapshot = async (queue: Queue): Promise<QueueSnapshot> => {
  const [counts, isPaused, workers, waitingJobs] = await Promise.all([
    queue.getJobCounts("waiting", "active", "delayed", "failed", "completed", "paused", "prioritized", "waiting-children"),
    queue.isPaused(),
    queue.getWorkers().then((items) => items.length).catch(() => 0),
    queue.getJobs(["waiting"], 0, 0, true),
  ]);

  const oldestWaitingJob = waitingJobs[0];
  const definition = getQueueDefinition(queue.name);
  return {
    name: queue.name,
    counts,
    isPaused,
    workers,
    oldestWaitingJobAgeMs: oldestWaitingJob ? Date.now() - oldestWaitingJob.timestamp : null,
    parallelism: definition ? getQueueParallelism(definition, workers) : null,
  };
};

export const getQueueSnapshots = async (queues: Queue[]) => Promise.all(queues.map((queue) => getQueueSnapshot(queue)));

const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|api[-_]?key|access[-_]?key|credential|executionAuth)/i;

const redactSensitiveDataInternal = (value: unknown, seen: WeakSet<object>): unknown => {
  if (Array.isArray(value)) return value.map((item) => redactSensitiveDataInternal(item, seen));
  if (!value || typeof value !== "object") return value;

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof Error) {
    return redactSensitiveDataInternal({
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: value.cause,
    }, seen);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSensitiveDataInternal(nestedValue, seen),
    ]),
  );
};

export const redactSensitiveData = (value: unknown): unknown => redactSensitiveDataInternal(value, new WeakSet());

export const getRedisHost = (value: string) => {
  try {
    return new URL(value).host;
  } catch {
    return "(invalid URL)";
  }
};
