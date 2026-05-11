import { ChannelsApi } from "./apis/channels.js";
import { CronJobsApi } from "./apis/cron-jobs.js";
import { ModelsApi } from "./apis/models.js";
import { PromptsApi } from "./apis/prompts.js";
import { SessionAccessApi } from "./apis/session-access.js";
import { SpaceClient, SpacesApi } from "./apis/spaces.js";
import { TasksApi } from "./apis/tasks.js";
import { UserApi } from "./apis/user.js";
import { PublicInviteApi } from "./apis/invitations.js";
import { HttpTransport, HttpError, type CohubClientOptions, type Fetch } from "./transport.js";
import { resolveApiBaseUrl } from "./environment.js";

export class CohubHttpClient {
  readonly spaces: SpacesApi;
  readonly channels: ChannelsApi;
  readonly user: UserApi;
  readonly models: ModelsApi;
  readonly prompts: PromptsApi;
  readonly sessionAccess: SessionAccessApi;
  readonly tasks: TasksApi;
  readonly cronJobs: CronJobsApi;
  readonly invite: PublicInviteApi;

  private readonly transport: HttpTransport;

  constructor(options: CohubClientOptions = {}) {
    const apiBaseUrl = resolveApiBaseUrl(options);
    this.transport = new HttpTransport(options);
    this.spaces = new SpacesApi(this.transport);
    this.channels = new ChannelsApi(this.transport);
    this.user = new UserApi(
      this.transport,
      apiBaseUrl,
      options.setStoredAuthToken,
      options.clearStoredAuthToken,
    );
    this.models = new ModelsApi(this.transport);
    this.prompts = new PromptsApi(this.transport);
    this.sessionAccess = new SessionAccessApi(this.transport);
    this.tasks = new TasksApi(this.transport);
    this.cronJobs = new CronJobsApi(this.transport);
    this.invite = new PublicInviteApi(this.transport);
  }

  space(spaceId: string) {
    return new SpaceClient(spaceId, this.transport, null);
  }
}

export const createHttpClient = (options?: CohubClientOptions) =>
  new CohubHttpClient(options);

export { HttpTransport, HttpError };
export type { CohubClientOptions, Fetch };
export * from "./types.js";
