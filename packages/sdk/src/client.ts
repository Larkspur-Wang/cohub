import { ChannelsApi } from "./apis/channels.js";
import { CronJobsApi } from "./apis/cron-jobs.js";
import { ExploreApi } from "./apis/explore.js";
import { ModelsApi } from "./apis/models.js";
import { PromptsApi } from "./apis/prompts.js";
import { SessionAccessApi } from "./apis/session-access.js";
import { SpaceClient, SpacesApi, type WebSocketConnectionState } from "./apis/spaces.js";
import { TasksApi } from "./apis/tasks.js";
import { UserApi } from "./apis/user.js";
import { PublicInviteApi } from "./apis/invitations.js";
import { HttpTransport, type CohubClientOptions } from "./transport.js";
import { createWebsocketClient } from "./websocket.js";
import { resolveApiBaseUrl, resolveWebsocketUrl } from "./environment.js";

export class CohubClient {
  readonly spaces: SpacesApi;
  readonly channels: ChannelsApi;
  readonly user: UserApi;
  readonly models: ModelsApi;
  readonly prompts: PromptsApi;
  readonly sessionAccess: SessionAccessApi;
  readonly tasks: TasksApi;
  readonly cronJobs: CronJobsApi;
  readonly explore: ExploreApi;
  readonly invite: PublicInviteApi;

  private readonly transport: HttpTransport;
  private readonly websocketClient: ReturnType<typeof createWebsocketClient>;

  constructor(options: CohubClientOptions = {}) {
    const apiBaseUrl = resolveApiBaseUrl(options);
    this.transport = new HttpTransport(options);
    this.websocketClient = createWebsocketClient({
      url: resolveWebsocketUrl({
        env: options.websocket?.env ?? options.env,
        url: options.websocket?.url,
      }),
      ...options.websocket,
      getAccessToken: options.getAccessToken,
    });
    this.spaces = new SpacesApi(this.transport);
    this.channels = new ChannelsApi(this.transport);
    this.user = new UserApi(
      this.transport,
      apiBaseUrl,
      options.setStoredAuthToken,
      options.clearStoredAuthToken,
    );
    this.models = new ModelsApi(this.transport);
    this.prompts = new PromptsApi(options.fetch ?? fetch, apiBaseUrl);
    this.sessionAccess = new SessionAccessApi(this.transport);
    this.tasks = new TasksApi(this.transport);
    this.cronJobs = new CronJobsApi(this.transport);
    this.explore = new ExploreApi(this.transport);
    this.invite = new PublicInviteApi(this.transport);
  }

  space(spaceId: string) {
    return new SpaceClient(spaceId, this.transport, this.websocketClient);
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
