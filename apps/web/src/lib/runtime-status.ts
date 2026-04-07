import type { RuntimeStatus } from "@cohub/protocol";

type RuntimeStatusMeta = {
  label: string;
  dotColorClass: string;
  textColorClass: string;
  bgClass: string;
  canSend: boolean;
  canWake: boolean;
  canHibernate: boolean;
  canDelete: boolean;
};

export const runtimeStatusMeta: Record<RuntimeStatus, RuntimeStatusMeta> = {
  starting: {
    label: "Starting",
    dotColorClass: "text-status-starting",
    textColorClass: "text-status-starting",
    bgClass: "bg-status-starting",
    canSend: false,
    canWake: false,
    canHibernate: false,
    canDelete: false,
  },
  running: {
    label: "Running",
    dotColorClass: "text-status-running",
    textColorClass: "text-status-running",
    bgClass: "bg-status-running",
    canSend: true,
    canWake: false,
    canHibernate: true,
    canDelete: false,
  },
  hibernated: {
    label: "Hibernated",
    dotColorClass: "text-status-hibernated",
    textColorClass: "text-status-hibernated",
    bgClass: "bg-status-hibernated",
    canSend: false,
    canWake: true,
    canHibernate: false,
    canDelete: true,
  },
  error: {
    label: "Error",
    dotColorClass: "text-status-error",
    textColorClass: "text-status-error",
    bgClass: "bg-status-error",
    canSend: false,
    canWake: false,
    canHibernate: false,
    canDelete: true,
  },
  deleted: {
    label: "Deleted",
    dotColorClass: "text-text-tertiary",
    textColorClass: "text-text-tertiary",
    bgClass: "bg-text-tertiary",
    canSend: false,
    canWake: false,
    canHibernate: false,
    canDelete: false,
  },
};

export function getRuntimeStatusMeta(status: string | null | undefined): RuntimeStatusMeta {
  return (runtimeStatusMeta as Record<string, RuntimeStatusMeta>)[status ?? ""] ?? {
    label: "Unknown",
    dotColorClass: "text-text-tertiary",
    textColorClass: "text-text-tertiary",
    bgClass: "bg-text-tertiary",
    canSend: false,
    canWake: false,
    canHibernate: false,
    canDelete: false,
  };
}
