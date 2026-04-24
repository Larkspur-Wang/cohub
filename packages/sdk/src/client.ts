import { ChannelsApi } from "./apis/channels.js";
import { CronJobsApi } from "./apis/cron-jobs.js";
import { ModelsApi } from "./apis/models.js";
import { SessionAccessApi } from "./apis/session-access.js";
import { SpaceClient, SpacesApi, type WebSocketConnectionState } from "./apis/spaces.js";
import { TasksApi } from "./apis/tasks.js";
import { UserApi } from "./apis/user.js";
import { HttpTransport, type CohubClientOptions } from "./transport.js";
import { createWebsocketClient } from "./websocket.js";

export class CohubClient {
  readonly spaces: SpacesApi;
  readonly channels: ChannelsApi;
  readonly user: UserApi;
  readonly models: ModelsApi;
  readonly sessionAccess: SessionAccessApi;
  readonly tasks: TasksApi;
  readonly cronJobs: CronJobsApi;

  private readonly transport: HttpTransport;
  private readonly websocketClient: ReturnType<typeof createWebsocketClient>;

  constructor(options: CohubClientOptions = {}) {
    this.transport = new HttpTransport(options);
    this.websocketClient = createWebsocketClient({
      ...options.websocket,
      getAccessToken: options.getAccessToken,
    });
    this.spaces = new SpacesApi(this.transport);
    this.channels = new ChannelsApi(this.transport);
    this.user = new UserApi(
      this.transport,
      options.baseUrl ?? "",
      options.setStoredAuthToken,
      options.clearStoredAuthToken,
    );
    this.models = new ModelsApi(options.fetch ?? fetch, options.baseUrl ?? "");
    this.sessionAccess = new SessionAccessApi(this.transport);
    this.tasks = new TasksApi(this.transport);
    this.cronJobs = new CronJobsApi(this.transport);
  }

  space(spaceId: string) {
    return new SpaceClient(spaceId, this.transport, this.websocketClient);
  }

  onConnection(
    handler: (state: WebSocketConnectionState) => void,
  ): () => void {
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
    const errorCleanup = this.websocketClient.on("error", () => {
      handler({ state: "error", willReconnect: true });
    });
    return () => {
      openCleanup();
      closeCleanup();
      errorCleanup();
    };
  }
}

export const createCohubClient = (options?: CohubClientOptions) =>
  new CohubClient(options);
