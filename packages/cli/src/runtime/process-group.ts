import { readdir, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";

export class ProcessCleanupUncertainError extends Error {}

async function groupAlive(pid: number): Promise<boolean> {
  try { process.kill(-pid, 0); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
  if (process.platform !== "linux") return true;
  // Linux can retain reparented zombies: they cannot execute, but kill(0) still sees them.
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = await readFile(`/proc/${entry}/stat`, "utf8");
      // After removing `pid (comm)`: state, ppid, pgrp, session, ...
      const [state, _parentPid, processGroupId] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (Number(processGroupId) === pid && state !== "Z" && state !== "X") return true;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
  return false;
}

export async function stopProcessGroup(pid: number) {
  try {
    if (process.platform === "win32") {
      await new Promise<void>((resolve, reject) => {
        const task = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", timeout: 5000 });
        task.once("error", reject);
        task.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`taskkill exited ${code}`)));
      });
      return;
    }
    const signal = (value: NodeJS.Signals) => {
      try { process.kill(-pid, value); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    };
    signal("SIGTERM");
    const started = Date.now();
    while (await groupAlive(pid)) {
      const elapsed = Date.now() - started;
      if (elapsed >= 5000) throw new Error("Process group is still running");
      if (elapsed >= 2000) signal("SIGKILL");
      await delay(25);
    }
  } catch (cause) {
    throw new ProcessCleanupUncertainError("Tool process cleanup could not be confirmed; execution remains unresolved / 无法确认工具进程已停止，执行结果保持未确认", { cause });
  }
}
