import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, fetch }) => {
  const res = await fetch(`/api/spaces/${params.id}`);
  if (!res.ok) {
    error(404, "Space not found");
  }
  const space = await res.json();
  return { spaceId: params.id, space };
};
