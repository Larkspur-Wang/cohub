import type { ChannelEnvelope, SpaceRecord } from "@neta-art/cohub";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { sdk } from "$lib/sdk";
import { authStore } from "$lib/stores/auth.svelte";
import {
	cacheSpaceRecordSoon,
	getCachedSpaceRecord,
} from "$lib/stores/space-record-cache";

const MAX_VISIBLE = 3;
const MAX_SEEN = 240;
const AUTO_DISMISS_MS = 6000;
const NOTIFICATION_PROMPT_COOLDOWN_MS = 7 * 86_400_000;
const NOTIFICATION_PROMPT_MAX_DISMISSES = 2;
const NOTIFICATION_PROMPT_VERSION = "v1";

type TurnNotifyPayload = {
	spaceId: string;
	sessionId: string;
	turnId: string;
	status: string;
	finishReason?: string | null;
	userPreview: string | null;
	durationMs: number | null;
	stepCount: number | null;
	sequence: number | null;
	provider: string | null;
	model: string | null;
	completedAt: string | null;
};

export type TurnNotification = {
	id: string;
	spaceId: string;
	sessionId: string;
	turnId: string;
	status: string;
	userPreview: string | null;
	durationMs: number | null;
	stepCount: number | null;
	sequence: number | null;
	provider: string | null;
	model: string | null;
	completedAt: string | null;
	receivedAt: number;
	space: SpaceRecord | null;
	dismissAt: number | null;
	remainingMs: number;
	hovered: boolean;
};

type DesktopPromptState = {
	promptedAt?: number;
	dismissCount?: number;
};

function isBrowser() {
	return typeof window !== "undefined" && typeof document !== "undefined";
}

function promptStorageKey(userUuid: string | null) {
	return `cohub:desktop-notification-prompt:${userUuid ?? "anonymous"}:${NOTIFICATION_PROMPT_VERSION}`;
}

function readPromptState(userUuid: string | null): DesktopPromptState {
	if (!isBrowser()) return {};
	try {
		return (
			JSON.parse(localStorage.getItem(promptStorageKey(userUuid)) ?? "{}") ?? {}
		);
	} catch {
		return {};
	}
}

function writePromptState(userUuid: string | null, state: DesktopPromptState) {
	if (!isBrowser()) return;
	try {
		localStorage.setItem(promptStorageKey(userUuid), JSON.stringify(state));
	} catch {
		// Best-effort preference persistence.
	}
}

function isTurnNotifyEvent(event: ChannelEnvelope): event is ChannelEnvelope & {
	payload: TurnNotifyPayload;
} {
	if (event.type !== "session.turn.notify") return false;
	const payload = event.payload as Partial<TurnNotifyPayload>;
	return (
		typeof payload.spaceId === "string" &&
		typeof payload.sessionId === "string" &&
		typeof payload.turnId === "string" &&
		typeof payload.status === "string"
	);
}

function currentRouteTarget() {
	const data = page.data as { spaceId?: unknown; sessionId?: unknown };
	const spaceId =
		typeof data.spaceId === "string"
			? data.spaceId
			: typeof page.params.id === "string"
				? page.params.id
				: null;
	const querySessionId = page.url.searchParams.get("session");
	const sessionId =
		typeof data.sessionId === "string" ? data.sessionId : querySessionId;
	return { spaceId, sessionId };
}

function spaceTitle(space: SpaceRecord | null, fallback: string) {
	return space?.title || space?.name || space?.slug || fallback;
}

function notificationHref(
	notification: Pick<TurnNotification, "spaceId" | "sessionId">,
) {
	return `/spaces/${notification.spaceId}?session=${notification.sessionId}`;
}

function statusLabel(status: string) {
	if (status === "completed") return "Completed";
	if (status === "failed") return "Failed";
	if (status === "interrupted") return "Interrupted";
	if (status === "cancelled") return "Cancelled";
	if (status === "merged") return "Merged";
	return status ? status[0]?.toUpperCase() + status.slice(1) : "Finished";
}

function formatDuration(durationMs: number | null) {
	if (
		typeof durationMs !== "number" ||
		!Number.isFinite(durationMs) ||
		durationMs < 0
	)
		return null;
	if (durationMs < 1000) return "<1s";
	if (durationMs < 60_000) return `${Math.round(durationMs / 100) / 10}s`;
	const minutes = Math.floor(durationMs / 60_000);
	const seconds = Math.round((durationMs % 60_000) / 1000);
	return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function getTurnNotificationMeta(
	notification: Pick<
		TurnNotification,
		"status" | "durationMs" | "stepCount" | "model"
	>,
) {
	return [
		statusLabel(notification.status),
		formatDuration(notification.durationMs),
		typeof notification.stepCount === "number" && notification.stepCount > 0
			? `${notification.stepCount} ${notification.stepCount === 1 ? "step" : "steps"}`
			: null,
		notification.model,
	]
		.filter(Boolean)
		.join(" · ");
}

function canUseDesktopNotifications() {
	return isBrowser() && "Notification" in window;
}

class TurnNotificationsStore {
	items = $state<TurnNotification[]>([]);
	desktopPermission = $state<NotificationPermission>("default");
	showDesktopPrompt = $state(false);
	private cleanup: (() => void) | null = null;
	private seenTurnIds: string[] = [];
	private tickTimer: number | null = null;
	private visible = true;
	private focused = true;

	get visibleItems() {
		return this.items.slice(0, MAX_VISIBLE);
	}

	get hiddenCount() {
		return Math.max(0, this.items.length - MAX_VISIBLE);
	}

	start() {
		if (this.cleanup || !isBrowser()) return;
		this.desktopPermission = canUseDesktopNotifications()
			? Notification.permission
			: "denied";
		this.visible = !document.hidden;
		this.focused = document.hasFocus();
		const offEvent = sdk.onUserEvent((event) => this.handleEvent(event));
		const onVisibility = () => {
			this.visible = !document.hidden;
			this.syncCountdowns();
		};
		const onFocus = () => {
			this.focused = true;
			this.syncCountdowns();
		};
		const onBlur = () => {
			this.focused = false;
			this.syncCountdowns();
		};
		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("focus", onFocus);
		window.addEventListener("blur", onBlur);
		this.cleanup = () => {
			offEvent();
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("focus", onFocus);
			window.removeEventListener("blur", onBlur);
			this.stopTick();
		};
	}

	stop() {
		this.cleanup?.();
		this.cleanup = null;
	}

	dismiss(id: string) {
		this.items = this.items.filter((item) => item.id !== id);
		this.syncTick();
	}

	setHovered(id: string, hovered: boolean) {
		this.items = this.items.map((item) =>
			item.id === id ? { ...item, hovered } : item,
		);
		this.syncCountdowns();
	}

	openCurrentTab(notification: TurnNotification) {
		this.dismiss(notification.id);
		void goto(notificationHref(notification));
	}

	openNewTab(notification: TurnNotification) {
		this.dismiss(notification.id);
		window.open(notificationHref(notification), "_blank", "noreferrer");
	}

	async enableDesktopNotifications() {
		if (!canUseDesktopNotifications()) return;
		const permission = await Notification.requestPermission();
		this.desktopPermission = permission;
		this.showDesktopPrompt = false;
		writePromptState(authStore.userUuid, {
			promptedAt: Date.now(),
			dismissCount: 0,
		});
	}

	dismissDesktopPrompt() {
		const state = readPromptState(authStore.userUuid);
		writePromptState(authStore.userUuid, {
			promptedAt: Date.now(),
			dismissCount: (state.dismissCount ?? 0) + 1,
		});
		this.showDesktopPrompt = false;
	}

	private handleEvent(event: ChannelEnvelope) {
		if (!isTurnNotifyEvent(event)) return;
		void this.handleTurnNotifyEvent(event);
	}

	private async handleTurnNotifyEvent(
		event: ChannelEnvelope & { payload: TurnNotifyPayload },
	) {
		const payload = event.payload;
		if (this.hasSeen(payload.turnId)) return;

		if (canUseDesktopNotifications())
			this.desktopPermission = Notification.permission;
		const current = currentRouteTarget();
		const activelyObserved = this.visible && this.focused;
		if (
			activelyObserved &&
			current.spaceId === payload.spaceId &&
			current.sessionId === payload.sessionId
		) {
			return;
		}
		this.markSeen(payload.turnId);

		const cachedSpace =
			(await getCachedSpaceRecord(payload.spaceId).catch(() => null))?.space ??
			null;
		const item: TurnNotification = {
			id: event.id || payload.turnId,
			spaceId: payload.spaceId,
			sessionId: payload.sessionId,
			turnId: payload.turnId,
			status: payload.status,
			userPreview: payload.userPreview,
			durationMs: payload.durationMs,
			stepCount: payload.stepCount,
			sequence: payload.sequence,
			provider: payload.provider,
			model: payload.model,
			completedAt: payload.completedAt,
			receivedAt: Date.now(),
			space: cachedSpace,
			dismissAt: null,
			remainingMs: AUTO_DISMISS_MS,
			hovered: false,
		};
		this.items = [
			item,
			...this.items.filter((existing) => existing.turnId !== item.turnId),
		];
		if (!cachedSpace) void this.hydrateSpace(item.spaceId);
		this.maybeShowDesktopPrompt();
		this.maybeSendDesktopNotification(item);
		this.syncCountdowns();
	}

	private async hydrateSpace(spaceId: string) {
		const cached = await getCachedSpaceRecord(spaceId).catch(() => null);
		if (cached?.space) {
			this.applySpace(cached.space);
			return;
		}
		const fetched = await sdk.spaces.get(spaceId).catch(() => null);
		if (!fetched) return;
		cacheSpaceRecordSoon(fetched);
		this.applySpace(fetched);
	}

	private applySpace(space: SpaceRecord) {
		this.items = this.items.map((item) =>
			item.spaceId === space.id ? { ...item, space } : item,
		);
	}

	private maybeShowDesktopPrompt() {
		if (!canUseDesktopNotifications() || this.desktopPermission !== "default")
			return;
		const state = readPromptState(authStore.userUuid);
		if ((state.dismissCount ?? 0) >= NOTIFICATION_PROMPT_MAX_DISMISSES) return;
		if (
			state.promptedAt &&
			Date.now() - state.promptedAt < NOTIFICATION_PROMPT_COOLDOWN_MS
		) {
			return;
		}
		this.showDesktopPrompt = true;
	}

	private maybeSendDesktopNotification(item: TurnNotification) {
		if (!canUseDesktopNotifications() || this.desktopPermission !== "granted")
			return;
		if (!document.hidden) return;
		const title = spaceTitle(item.space, "Space");
		const body = [item.userPreview, getTurnNotificationMeta(item)]
			.filter(Boolean)
			.join("\n");
		const notification = new Notification(`${title} finished a turn`, {
			body,
			icon: item.space?.publicProfile?.avatarUrl ?? undefined,
			tag: `turn:${item.turnId}`,
		});
		notification.onclick = () => {
			window.focus();
			void goto(notificationHref(item));
			notification.close();
		};
	}

	private syncCountdowns() {
		const active = this.visible && this.focused;
		const now = Date.now();
		this.items = this.items.map((item) => {
			if (!active || item.hovered) {
				return item.dismissAt
					? {
							...item,
							remainingMs: Math.max(0, item.dismissAt - now),
							dismissAt: null,
						}
					: item;
			}
			return item.dismissAt
				? item
				: { ...item, dismissAt: now + item.remainingMs };
		});
		this.syncTick();
	}

	private syncTick() {
		const shouldTick = this.items.some((item) => item.dismissAt !== null);
		if (shouldTick) {
			this.startTick();
		} else {
			this.stopTick();
		}
	}

	private startTick() {
		if (this.tickTimer !== null) return;
		this.tickTimer = window.setInterval(() => {
			const now = Date.now();
			this.items = this.items.filter(
				(item) => !item.dismissAt || item.dismissAt > now,
			);
			this.syncTick();
		}, 250);
	}

	private stopTick() {
		if (this.tickTimer === null) return;
		window.clearInterval(this.tickTimer);
		this.tickTimer = null;
	}

	private hasSeen(turnId: string) {
		return this.seenTurnIds.includes(turnId);
	}

	private markSeen(turnId: string) {
		this.seenTurnIds = [
			turnId,
			...this.seenTurnIds.filter((id) => id !== turnId),
		].slice(0, MAX_SEEN);
	}
}

export const turnNotifications = new TurnNotificationsStore();

export function getTurnNotificationHref(
	notification: Pick<TurnNotification, "spaceId" | "sessionId">,
) {
	return notificationHref(notification);
}

export function getTurnNotificationSpaceTitle(
	notification: Pick<TurnNotification, "space" | "spaceId">,
) {
	return spaceTitle(notification.space, notification.spaceId);
}
