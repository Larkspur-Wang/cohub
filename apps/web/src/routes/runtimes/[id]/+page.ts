import { error, redirect } from "@sveltejs/kit";
import {
  getRuntime,
  getRuntimeSessions,
  getSessionMessages,
  getSessionTree,
} from "$lib/api";

export const load = async ({ params, fetch }) => {
  try {
    const runtime = await getRuntime(params.id, fetch);
    const sessionsResponse = await getRuntimeSessions(params.id, fetch);
    const currentSessionId =
      runtime.currentSessionId ?? sessionsResponse.sessions.at(-1)?.id ?? null;

    if (!currentSessionId) {
      return {
        runtime,
        session: null,
        persisted: null,
        tree: null,
      };
    }

    const [persisted, tree] = await Promise.all([
      getSessionMessages(currentSessionId, fetch),
      getSessionTree(currentSessionId, fetch),
    ]);

    return {
      runtime,
      session: persisted.session,
      persisted,
      tree,
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
