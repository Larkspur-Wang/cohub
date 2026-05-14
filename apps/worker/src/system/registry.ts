import type { Job } from "bullmq";

export type SystemJobHandler = (job: Job) => Promise<Record<string, unknown> | undefined>;

const registry = new Map<string, SystemJobHandler>();

export function registerSystemJob(name: string, handler: SystemJobHandler) {
  registry.set(name, handler);
}

export function getSystemJobHandler(name: string) {
  return registry.get(name);
}

export function getRegisteredSystemJobs() {
  return Array.from(registry.keys());
}
