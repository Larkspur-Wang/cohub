import { error, redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import {
  getRuntime,
  getRuntimeSessionGraph,
  getSessionMessages,
} from "$lib/api";

export const load: PageLoad = async ({ params, fetch }) => {
  try {
    const runtime = await getRuntime(params.id, fetch);
    const graph = await getRuntimeSessionGraph(params.id, fetch);

    const messagePreviewById: Record<string, string> = {};

    for (const session of graph.sessions) {
      if (!session.parentSessionId || !session.forkedFromMessageId) continue;
      try {
        const parentMessages = await getSessionMessages(session.parentSessionId, fetch);
        const matched = parentMessages.messages.find((message) => message.id === session.forkedFromMessageId);
        if (matched) {
          messagePreviewById[matched.id] = matched.text ?? matched.role;
        }
      } catch {
        // ignore preview load failures
      }
    }

    return {
      runtime,
      sessions: graph.sessions,
      messagePreviewById,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (
      message.includes("unauthorized") ||
      message.includes("401") ||
      message.includes("403")
    ) {
      throw redirect(302, "/");
    }

    if (message.includes("runtime not found") || message.includes("404")) {
      throw error(404, "Runtime not found");
    }

    throw error(500, `Failed to load runtime graph: ${message}`);
  }
};
