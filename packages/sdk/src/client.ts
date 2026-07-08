import { ChannelsApi } from "./apis/channels.js";
import { BillingApi } from "./apis/billing.js";
import { CronJobsApi } from "./apis/cron-jobs.js";
import { ExploreApi } from "./apis/explore.js";
import { GenerationsApi } from "./apis/generations.js";
import { ModelsApi } from "./apis/models.js";
import { PromptsApi } from "./apis/prompts.js";
import { PublicAssetsApi } from "./apis/public-assets.js";
import { SessionAccessApi } from "./apis/session-access.js";
import { SearchApi } from "./apis/search.js";
import { ReferencesApi } from "./apis/references.js";
import { SpaceClient, SpacesApi, type WebSocketConnectionState } from "./apis/spaces.js";
import { TasksApi } from "./apis/tasks.js";
import { UserApi } from "./apis/user.js";
import { UsersApi } from "./apis/users.js";
import { WorksApi } from "./apis/works.js";
import { WorkCommerceApi } from "./apis/work-commerce.js";
import { PublicInviteApi } from "./apis/invitations.js";
import { HttpTransport, type CohubClientOptions } from "./transport.js";
import { ensureRealtimeConnected } from "./realtime.js";
import { createWebsocketClient, type WebsocketEventPayload } from "./websocket.js";
import { VoiceApi } from "./voice-input.js";
import { resolveApiBaseUrl, resolveWebsocketUrl } from "./environment.js";
import {
  createWorkRuntime,
  resolveWorkTransport,
  type WorkRuntimeApi,
} from "./work-runtime.js";
import type { Permission } from "./types.js";
import type { WorkCommerceCheckoutStatus } from "./apis/work-commerce.js";

export class CohubClient {
  readonly spaces: SpacesApi;
  readonly channels: ChannelsApi;
  readonly billing: BillingApi;
  readonly user: UserApi;
  readonly users: UsersApi;
  readonly generations: GenerationsApi;
  readonly models: ModelsApi;
  readonly prompts: PromptsApi;
  readonly publicAssets: PublicAssetsApi;
  readonly sessionAccess: SessionAccessApi;
  readonly search: SearchApi;
  readonly references: ReferencesApi;
  readonly tasks: TasksApi;
  readonly cronJobs: CronJobsApi;
  readonly explore: ExploreApi;
  readonly invite: PublicInviteApi;
  readonly voice: VoiceApi;
  readonly works: WorksApi;
  readonly workCommerce: WorkCommerceApi;

  private readonly transport: HttpTransport;
  private readonly websocketClient: ReturnType<typeof createWebsocketClient>;
  private readonly workRuntime: WorkRuntimeApi;

  constructor(options: CohubClientOptions = {}) {
    const apiBaseUrl = resolveApiBaseUrl(options);
    const workTransport = resolveWorkTransport(options.work);
    this.workRuntime = createWorkRuntime(workTransport, options.work?.workId);
    const getAccessToken = options.getAccessToken ?? ((tokenOptions?: { forceRefresh?: boolean }) => this.workRuntime.getAccessToken(tokenOptions));
    const resolvedOptions = { ...options, getAccessToken };
    this.transport = new HttpTransport(resolvedOptions);
    this.websocketClient = createWebsocketClient({
      url: resolveWebsocketUrl({
        env: options.websocket?.env ?? options.env,
        url: options.websocket?.url,
      }),
      ...options.websocket,
      getAccessToken: options.websocket?.getAccessToken ?? getAccessToken,
    });
    this.voice = new VoiceApi({
      env: options.voice?.env ?? options.env,
      url: options.voice?.url,
      getAccessToken: options.voice?.getAccessToken ?? getAccessToken,
      WebSocketImpl: options.voice?.WebSocketImpl,
      connectionTimeoutMs: options.voice?.connectionTimeoutMs,
      idleConnectionTimeoutMs: options.voice?.idleConnectionTimeoutMs,
    });
    this.spaces = new SpacesApi(this.transport);
    this.channels = new ChannelsApi(this.transport);
    this.billing = new BillingApi(this.transport);
    this.user = new UserApi(
      this.transport,
      apiBaseUrl,
      options.setStoredAuthToken,
      options.clearStoredAuthToken,
    );
    this.users = new UsersApi(this.transport);
    this.generations = new GenerationsApi(this.transport);
    this.models = new ModelsApi(this.transport);
    this.prompts = new PromptsApi(this.transport);
    this.publicAssets = new PublicAssetsApi(this.transport);
    this.sessionAccess = new SessionAccessApi(this.transport);
    this.search = new SearchApi(this.transport);
    this.references = new ReferencesApi(this.transport);
    this.tasks = new TasksApi(this.transport);
    this.cronJobs = new CronJobsApi(this.transport);
    this.explore = new ExploreApi(this.transport);
    this.invite = new PublicInviteApi(this.transport);
    this.works = new WorksApi(this.transport);
    this.workCommerce = new WorkCommerceApi(this.transport);
  }

  context() {
    return this.workRuntime.context();
  }

  readonly auth = {
    request: (input: { scopes: Permission[]; reason?: string }) => this.workRuntime.requestAuthorization(input),
  };

  readonly work = {
    commerce: {
      resolveProducts: async (input: { productKeys: string[] }) => {
        const context = await this.workRuntime.context();
        if (!context?.work?.id) throw new Error("Work context is unavailable — not running inside a published Work runtime.");
        return this.workCommerce.resolveProducts(context.work.id, input);
      },
      getEntitlements: async () => {
        const context = await this.workRuntime.context();
        if (!context?.work?.id) throw new Error("Work context is unavailable — not running inside a published Work runtime.");
        return this.workCommerce.getEntitlements(context.work.id);
      },
      consumeCredits: async (input: { amount: number; operationId: string; reason?: string }) => {
        const context = await this.workRuntime.context();
        if (!context?.work?.id) throw new Error("Work context is unavailable — not running inside a published Work runtime.");
        return this.workCommerce.consumeCredits(context.work.id, input);
      },
      purchase: async (input: { productKey: string }) => this.workRuntime.purchase(input),
      getCheckoutState: async (): Promise<{ status: WorkCommerceCheckoutStatus; orderId: string | null }> => {
        const result = await this.workRuntime.checkoutState();
        return { status: result?.status ?? null, orderId: result?.orderId ?? null };
      },
      getOrder: async (orderId: string) => {
        const context = await this.workRuntime.context();
        if (!context?.work?.id) throw new Error("Work context is unavailable — not running inside a published Work runtime.");
        return this.workCommerce.getOrder(context.work.id, orderId);
      },
    },
  };

  space(spaceId: string) {
    return new SpaceClient(spaceId, this.transport, this.websocketClient);
  }

  onUserEvent(handler: (event: WebsocketEventPayload) => void): () => void {
    ensureRealtimeConnected(this.websocketClient);
    return this.websocketClient.on("event", handler);
  }

  onConnection(
    handler: (state: WebSocketConnectionState) => void,
  ): () => void {
    const connectingCleanup = this.websocketClient.on("connecting", (payload) => {
      handler({
        state: payload.isReconnect ? "reconnecting" : "connecting",
        willReconnect: payload.isReconnect,
        attempt: payload.attempt,
      });
    });
    const reconnectingCleanup = this.websocketClient.on("reconnecting", (payload) => {
      handler({
        state: "reconnecting",
        willReconnect: true,
        attempt: payload.attempt,
        delayMs: payload.delayMs,
      });
    });
    const openCleanup = this.websocketClient.on("open", (payload) => {
      handler({
        state: "open",
        willReconnect: false,
        connectionId: payload.connectionId,
      });
    });
    const closeCleanup = this.websocketClient.on("close", (payload) => {
      handler({
        state: "closed",
        willReconnect: payload.willReconnect,
      });
    });
    const errorCleanup = this.websocketClient.on("error", (payload) => {
      handler({
        state: "error",
        willReconnect: payload.recoverable,
        recoverable: payload.recoverable,
      });
    });
    return () => {
      connectingCleanup();
      reconnectingCleanup();
      openCleanup();
      closeCleanup();
      errorCleanup();
    };
  }
}

export const createCohubClient = (options?: CohubClientOptions) =>
  new CohubClient(options);
