export type DeleteChannelResult = "deleted" | "not_found" | "bound";

export function deleteChannelResponse(result: DeleteChannelResult) {
  if (result === "not_found") return { body: { message: "channel not found" }, status: 404 as const };
  if (result === "bound") return { body: { message: "channel is bound to a space" }, status: 409 as const };
  return { body: { ok: true }, status: 200 as const };
}
