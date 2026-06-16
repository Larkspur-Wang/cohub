import { redirect } from "@sveltejs/kit";
import { buildSpaceLandingRoute } from "$lib/space-routes";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => {
	throw redirect(307, buildSpaceLandingRoute(params.id));
};
