import { error, redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import {
  getRuntime,
  getRuntimeSessions,
  getSessionMessages,
} from "$lib/api";

export const load: PageLoad = async ({ params, fetch }) => {
  try {
    const runtime = await getRuntime(params.id, fetch);
    const sessionsResponse = await getRuntimeSessions(params.id, fetch);
    const bootstrapSessionId = sessionsResponse.sessions.at(-1)?.id ?? null;

    if (!bootstrapSessionId) {
      return {
        runtime,
        session: null,
        persisted: null,
      };
    }

    const persisted = await getSessionMessages(bootstrapSessionId, fetch);

    return {
      runtime,
      session: persisted.session,
      persisted,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[runtimes/:id] load failed:", message, err);

    if (
      message.includes("unauthorized") ||
      message.includes("401") ||
      message.includes("403")
    ) {
      throw redirect(302, "/login");
    }

    if (message.includes("runtime not found") || message.includes("404")) {
      throw error(404, "Runtime not found");
    }

    throw error(500, `Failed to load runtime: ${message}`);
  }
};
