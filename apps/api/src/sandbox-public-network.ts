import type { V1Service } from "@kubernetes/client-node";
import { config, sessionsNamespace } from "./config.js";
import { k8sCoreApi, k8sCustomObjectsApi } from "./k8s.js";

const SANDBOX_PUBLIC_PORTS = [3000, 5173] as const;
const HTTP_ROUTE_GROUP = "gateway.networking.k8s.io";
const HTTP_ROUTE_VERSION = "v1";
const HTTP_ROUTE_PLURAL = "httproutes";
const GATEWAY_NAMESPACE = "kube-system";
const GATEWAY_NAME = "traefik-gateway";
const SANDBOX_PUBLIC_DOMAIN = "cohub.run";

type SandboxPublicPort = (typeof SANDBOX_PUBLIC_PORTS)[number];
type HttpRouteObject = {
  apiVersion: `${typeof HTTP_ROUTE_GROUP}/${typeof HTTP_ROUTE_VERSION}`;
  kind: "HTTPRoute";
  metadata: {
    name: string;
    namespace: string;
    labels: Record<string, string>;
    resourceVersion?: string;
  };
  spec: {
    parentRefs: Array<{ name: string; namespace: string }>;
    hostnames: string[];
    rules: Array<{
      matches: Array<{
        path: { type: "PathPrefix"; value: "/" };
      }>;
      backendRefs: Array<{ name: string; port: SandboxPublicPort }>;
    }>;
  };
};

const getK8sStatusCode = (error: unknown) => {
  return (error as { statusCode?: number; code?: number }).statusCode
    ?? (error as { statusCode?: number; code?: number }).code
    ?? null;
};

export const getSandboxPublicServiceName = (spaceId: string) => `sandbox-${spaceId}`;

export const getSandboxPublicRouteName = (spaceId: string, port: SandboxPublicPort) => `sandbox-${spaceId}-p${port}-route`;

export const getSandboxPublicHostname = (spaceId: string, port: SandboxPublicPort) => {
  const prefix = config.env === "prod" ? "s" : "d";
  return `${prefix}-${spaceId}-${port}.${SANDBOX_PUBLIC_DOMAIN}`;
};

export const getSandboxPublicEndpoints = (spaceId: string) => {
  return Object.fromEntries(
    SANDBOX_PUBLIC_PORTS.map((port) => [port, `https://${getSandboxPublicHostname(spaceId, port)}`]),
  ) as Record<SandboxPublicPort, string>;
};

export const attachSandboxPublicEndpoints = <T extends { spaceId: string }>(sandbox: T | null) => {
  if (!sandbox) return null;
  return {
    ...sandbox,
    publicEndpoints: getSandboxPublicEndpoints(sandbox.spaceId),
  };
};

const buildSandboxPublicService = (spaceId: string): V1Service => ({
  apiVersion: "v1",
  kind: "Service",
  metadata: {
    name: getSandboxPublicServiceName(spaceId),
    namespace: sessionsNamespace,
    labels: {
      app: "agent-sandbox",
      "space-id": spaceId,
      "cohub.dev/public-service": "true",
    },
  },
  spec: {
    type: "ClusterIP",
    selector: {
      app: "agent-sandbox",
      "space-id": spaceId,
    },
    ports: SANDBOX_PUBLIC_PORTS.map((port) => ({
      name: `p${port}`,
      port,
      targetPort: port,
      protocol: "TCP",
    })),
  },
});

const buildSandboxPublicRoute = (spaceId: string, port: SandboxPublicPort): HttpRouteObject => ({
  apiVersion: `${HTTP_ROUTE_GROUP}/${HTTP_ROUTE_VERSION}`,
  kind: "HTTPRoute",
  metadata: {
    name: getSandboxPublicRouteName(spaceId, port),
    namespace: sessionsNamespace,
    labels: {
      app: "agent-sandbox",
      "space-id": spaceId,
      "cohub.dev/public-route": "true",
    },
  },
  spec: {
    parentRefs: [{
      name: GATEWAY_NAME,
      namespace: GATEWAY_NAMESPACE,
    }],
    hostnames: [getSandboxPublicHostname(spaceId, port)],
    rules: [{
      matches: [{
        path: {
          type: "PathPrefix",
          value: "/",
        },
      }],
      backendRefs: [{
        name: getSandboxPublicServiceName(spaceId),
        port,
      }],
    }],
  },
});

const reconcileSandboxPublicService = async (spaceId: string) => {
  const name = getSandboxPublicServiceName(spaceId);
  const desired = buildSandboxPublicService(spaceId);

  try {
    const existing = await k8sCoreApi.readNamespacedService({
      name,
      namespace: sessionsNamespace,
    });
    desired.metadata = {
      ...(desired.metadata ?? {}),
      resourceVersion: existing.metadata?.resourceVersion,
    };
    desired.spec = {
      ...(desired.spec ?? {}),
      clusterIP: existing.spec?.clusterIP,
      clusterIPs: existing.spec?.clusterIPs,
      internalTrafficPolicy: existing.spec?.internalTrafficPolicy,
      ipFamilies: existing.spec?.ipFamilies,
      ipFamilyPolicy: existing.spec?.ipFamilyPolicy,
      sessionAffinity: existing.spec?.sessionAffinity,
    };
    await k8sCoreApi.replaceNamespacedService({
      name,
      namespace: sessionsNamespace,
      body: desired,
    });
  } catch (error: unknown) {
    if (getK8sStatusCode(error) !== 404) throw error;
    await k8sCoreApi.createNamespacedService({
      namespace: sessionsNamespace,
      body: desired,
    });
  }
};

const reconcileSandboxPublicRoute = async (spaceId: string, port: SandboxPublicPort) => {
  const name = getSandboxPublicRouteName(spaceId, port);
  const desired = buildSandboxPublicRoute(spaceId, port);

  try {
    const existing = await k8sCustomObjectsApi.getNamespacedCustomObject({
      group: HTTP_ROUTE_GROUP,
      version: HTTP_ROUTE_VERSION,
      namespace: sessionsNamespace,
      plural: HTTP_ROUTE_PLURAL,
      name,
    }) as { metadata?: { resourceVersion?: string } };
    desired.metadata.resourceVersion = existing.metadata?.resourceVersion;
    await k8sCustomObjectsApi.replaceNamespacedCustomObject({
      group: HTTP_ROUTE_GROUP,
      version: HTTP_ROUTE_VERSION,
      namespace: sessionsNamespace,
      plural: HTTP_ROUTE_PLURAL,
      name,
      body: desired,
    });
  } catch (error: unknown) {
    if (getK8sStatusCode(error) !== 404) throw error;
    await k8sCustomObjectsApi.createNamespacedCustomObject({
      group: HTTP_ROUTE_GROUP,
      version: HTTP_ROUTE_VERSION,
      namespace: sessionsNamespace,
      plural: HTTP_ROUTE_PLURAL,
      body: desired,
    });
  }
};

export const reconcileSandboxPublicNetwork = async (spaceId: string) => {
  await reconcileSandboxPublicService(spaceId);
  await Promise.all(SANDBOX_PUBLIC_PORTS.map((port) => reconcileSandboxPublicRoute(spaceId, port)));
};

export const deleteSandboxPublicNetwork = async (spaceId: string) => {
  await Promise.allSettled([
    ...SANDBOX_PUBLIC_PORTS.map(async (port) => {
      try {
        await k8sCustomObjectsApi.deleteNamespacedCustomObject({
          group: HTTP_ROUTE_GROUP,
          version: HTTP_ROUTE_VERSION,
          namespace: sessionsNamespace,
          plural: HTTP_ROUTE_PLURAL,
          name: getSandboxPublicRouteName(spaceId, port),
        });
      } catch (error: unknown) {
        if (getK8sStatusCode(error) !== 404) throw error;
      }
    }),
    (async () => {
      try {
        await k8sCoreApi.deleteNamespacedService({
          name: getSandboxPublicServiceName(spaceId),
          namespace: sessionsNamespace,
        });
      } catch (error: unknown) {
        if (getK8sStatusCode(error) !== 404) throw error;
      }
    })(),
  ]);
};
