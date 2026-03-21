import { error, redirect } from "@sveltejs/kit";
import {
  getSession,
  getSessionMessages,
  getSessionTree,
} from "$lib/api";

export const load = async ({ params, fetch }) => {
  try {
    const [session, persisted, tree] = await Promise.all([
      getSession(params.id, fetch),
      getSessionMessages(params.id, fetch),
      getSessionTree(params.id, fetch),
    ]);

    return {
      session,
      persisted,
      tree,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[sessions/:id] load failed:", message, err);

    if (
      message.includes("unauthorized") ||
      message.includes("401") ||
      message.includes("403")
    ) {
      throw redirect(302, "/login");
    }

    if (message.includes("session not found") || message.includes("404")) {
      throw error(404, "Session not found");
    }

    throw error(500, `Failed to load session: ${message}`);
  }
};
