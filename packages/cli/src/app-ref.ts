import type { CohubHttpClient, ParsedAppRef, AppGetResponse } from "@neta-art/cohub";
import { formatAppRef, parseAppRef } from "@neta-art/cohub";

export type { ParsedAppRef };
export { formatAppRef, parseAppRef };

export function getAppByRef(client: CohubHttpClient, input: string): Promise<AppGetResponse> {
  const ref = parseAppRef(input);
  return "id" in ref
    ? client.apps.get(ref.id)
    : client.apps.getBySlug(ref.username, ref.spaceSlug, ref.appSlug);
}
