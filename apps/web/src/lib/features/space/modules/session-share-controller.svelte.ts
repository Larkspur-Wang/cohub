import type { SpaceAccessPolicy } from "@neta-art/cohub";
import { sdk } from "$lib/sdk";
import { buildSpaceSessionRoute } from "$lib/space-routes";

export function createSessionShareController(options: {
	getSpaceId: () => string;
	canManageAccess: () => boolean;
}) {
	let open = $state(false);
	let sessionId = $state<string | null>(null);
	let copied = $state(false);
	let error = $state("");
	let saving = $state(false);
	let accessById = $state<Record<string, SpaceAccessPolicy | null>>({});
	let copiedTimer: ReturnType<typeof setTimeout> | null = null;

	function clearCopiedTimer() {
		if (!copiedTimer) return;
		clearTimeout(copiedTimer);
		copiedTimer = null;
	}

	function markCopied() {
		copied = true;
		clearCopiedTimer();
		copiedTimer = setTimeout(() => {
			copied = false;
			copiedTimer = null;
		}, 2000);
	}

	function hasPermission(targetSessionId: string): boolean {
		const access = accessById[targetSessionId];
		return Boolean(access?.signed_in_user || access?.anonymous_user);
	}

	async function removeAccess(targetSessionId: string) {
		if (!options.canManageAccess()) return;
		try {
			await sdk.sessionAccess.remove(targetSessionId);
			accessById = { ...accessById, [targetSessionId]: null };
		} catch (error) {
			console.error("Failed to remove session access:", error);
		}
	}

	function openFor(targetSessionId: string) {
		if (!options.canManageAccess()) return;
		sessionId = targetSessionId;
		open = true;
		copied = false;
		error = "";
	}

	function close() {
		open = false;
	}

	async function shareAndCopyLink() {
		if (!sessionId || !options.canManageAccess()) return;
		error = "";
		saving = true;
		try {
			await sdk.sessionAccess.set(sessionId, { anonymous_user: "guest" });
			const url = `${window.location.origin}${buildSpaceSessionRoute(options.getSpaceId(), sessionId)}`;
			await navigator.clipboard.writeText(url);
			markCopied();
			accessById = {
				...accessById,
				[sessionId]: { signed_in_user: null, anonymous_user: "guest" },
			};
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to share session";
		} finally {
			saving = false;
		}
	}

	async function copyLink() {
		if (!sessionId) return;
		error = "";
		try {
			const url = `${window.location.origin}${buildSpaceSessionRoute(options.getSpaceId(), sessionId)}`;
			await navigator.clipboard.writeText(url);
			markCopied();
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to copy link";
		}
	}

	async function makePrivate() {
		if (!sessionId || !options.canManageAccess()) return;
		error = "";
		saving = true;
		try {
			await sdk.sessionAccess.remove(sessionId);
			accessById = { ...accessById, [sessionId]: null };
			open = false;
		} catch (err) {
			error =
				err instanceof Error ? err.message : "Failed to make session private";
		} finally {
			saving = false;
		}
	}

	async function removeCurrentPermission() {
		if (!sessionId) return;
		await removeAccess(sessionId);
		open = false;
	}

	function reset() {
		open = false;
		sessionId = null;
		accessById = {};
		error = "";
		copied = false;
		saving = false;
	}

	function dispose() {
		clearCopiedTimer();
	}

	return {
		get open() {
			return open;
		},
		get sessionId() {
			return sessionId;
		},
		get copied() {
			return copied;
		},
		get error() {
			return error;
		},
		get saving() {
			return saving;
		},
		get isCurrentPublic() {
			return sessionId ? hasPermission(sessionId) : false;
		},
		hasPermission,
		removeAccess,
		openFor,
		close,
		shareAndCopyLink,
		copyLink,
		makePrivate,
		removeCurrentPermission,
		reset,
		dispose,
	};
}
