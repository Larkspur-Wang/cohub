import { HttpError } from "@neta-art/cohub";
import { error } from "@sveltejs/kit";
import { sdk } from "$lib/sdk";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params }) => {
	try {
		const page = await sdk.users.getByUsername(params.username);
		return { page };
	} catch (err) {
		if (err instanceof HttpError && err.status === 404) {
			error(404, "User not found");
		}
		throw err;
	}
};
