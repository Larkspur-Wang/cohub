export const SANDBOX_PUBLIC_PORTS = [3000, 5173] as const;

export type SandboxPublicPort = (typeof SANDBOX_PUBLIC_PORTS)[number];

export type SpacePortStatus = "listening" | "closed";

export type SpacePortChange = {
  port: SandboxPublicPort | number;
  protocol: "tcp";
  status: SpacePortStatus;
  observedAt: number;
};

export type SpacePortsChangedPayload = {
  source: "sandbox-port-watch" | "sandbox-port-watch-started";
  seq?: number;
  resync?: boolean;
  ports: SpacePortChange[];
};

export type SpacePublicEndpoint = {
  url: string;
  status?: SpacePortStatus | "unknown";
  observedAt?: number;
};

export type SpacePublicEndpoints = Record<string, SpacePublicEndpoint>;
