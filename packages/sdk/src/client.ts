import { ChannelsApi } from "./apis/channels.js";
import { CronJobsApi } from "./apis/cron-jobs.js";
import { ModelsApi } from "./apis/models.js";
import { SessionPermissionsApi } from "./apis/session-permissions.js";
import { SpaceClient, SpacesApi } from "./apis/spaces.js";
import { TasksApi } from "./apis/tasks.js";
import { UserApi } from "./apis/user.js";
import { HttpTransport, type CohubClientOptions } from "./transport.js";
import { getWebsocketClient } from "./websocket.js";

export class CohubClient {
  readonly spaces: SpacesApi;
  readonly channels: ChannelsApi;
  readonly user: UserApi;
  readonly models: ModelsApi;
  readonly sessionPermissions: SessionPermissionsApi;
  readonly tasks: TasksApi;
  readonly cronJobs: CronJobsApi;

  private readonly transport: HttpTransport;
  private readonly websocketClient: ReturnType<typeof getWebsocketClient>;

  constructor(options: CohubClientOptions = {}) {
    this.transport = new HttpTransport(options);
    this.websocketClient = getWebsocketClient({
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
    this.sessionPermissions = new SessionPermissionsApi(this.transport);
    this.tasks = new TasksApi(this.transport);
    this.cronJobs = new CronJobsApi(this.transport);
  }

  space(spaceId: string) {
    return new SpaceClient(spaceId, this.transport, this.websocketClient);
  }
}

export const createCohubClient = (options?: CohubClientOptions) =>
  new CohubClient(options);
