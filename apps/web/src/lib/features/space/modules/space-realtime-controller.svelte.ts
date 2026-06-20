import { sdk } from "$lib/sdk";

export type SpaceConnectionState =
	| "idle"
	| "connecting"
	| "reconnecting"
	| "open"
	| "closed"
	| "error";

type ConnectionSnapshot = {
	state: SpaceConnectionState;
	connectionId?: string | null;
	recoverable?: boolean;
	willReconnect?: boolean;
};

export function createSpaceRealtimeController(options: {
	onTransportOpen: () => void;
	onConnectionOpened: () => void;
	onConnectionRecovered: () => void;
	onHidden: () => void;
	onVisible: () => void;
	onOnline: () => void;
	onOffline: () => void;
	onStatusVisibilityChanged: () => void;
}) {
	let connectionState = $state<SpaceConnectionState>("idle");
	let canRecover = $state(false);
	let pageVisible = $state(true);
	let pageOnline = $state(true);
	let lastRecoveredConnectionId: string | null = null;
	let lastConnectionState: SpaceConnectionState = "idle";
	let disposeConnection: (() => void) | null = null;
	let started = false;

	function markRecovered() {
		canRecover = false;
	}

	function handleConnection(snapshot: ConnectionSnapshot) {
		const previousState = lastConnectionState;
		lastConnectionState = snapshot.state;
		if (snapshot.state === "open") {
			options.onTransportOpen();
			connectionState = "open";
			canRecover = false;
			options.onConnectionOpened();
			const connectionId = snapshot.connectionId ?? null;
			const recoveredFromDisconnect =
				previousState === "reconnecting" ||
				previousState === "closed" ||
				previousState === "error";
			const isNewRecoveredConnection =
				Boolean(connectionId) && connectionId !== lastRecoveredConnectionId;
			if (recoveredFromDisconnect || isNewRecoveredConnection) {
				lastRecoveredConnectionId = connectionId;
				options.onConnectionRecovered();
			}
			return;
		}
		if (snapshot.state === "connecting") {
			connectionState = "connecting";
			canRecover = false;
			return;
		}
		if (snapshot.state === "reconnecting") {
			connectionState = "reconnecting";
			canRecover = true;
			return;
		}
		if (snapshot.state === "error") {
			connectionState = "error";
			canRecover = snapshot.recoverable ?? false;
			return;
		}
		if (snapshot.state === "closed") {
			connectionState = "closed";
			canRecover = snapshot.willReconnect ?? false;
		}
	}

	function handleVisibility() {
		pageVisible = !document.hidden;
		if (pageVisible) {
			options.onVisible();
		} else {
			options.onHidden();
		}
		options.onStatusVisibilityChanged();
	}

	function handleOnline() {
		pageOnline = true;
		options.onOnline();
		options.onStatusVisibilityChanged();
	}

	function handleOffline() {
		pageOnline = false;
		options.onOffline();
		options.onStatusVisibilityChanged();
	}

	function start() {
		if (started || typeof window === "undefined") return;
		started = true;
		pageVisible = !document.hidden;
		pageOnline = navigator.onLine;
		disposeConnection = sdk.onConnection((snapshot) => {
			handleConnection(snapshot as ConnectionSnapshot);
		});
		window.addEventListener("visibilitychange", handleVisibility);
		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);
	}

	function dispose() {
		if (!started || typeof window === "undefined") return;
		started = false;
		disposeConnection?.();
		disposeConnection = null;
		window.removeEventListener("visibilitychange", handleVisibility);
		window.removeEventListener("online", handleOnline);
		window.removeEventListener("offline", handleOffline);
	}

	function resetRecoveredConnection() {
		lastRecoveredConnectionId = null;
		lastConnectionState = "idle";
	}

	return {
		get connectionState() {
			return connectionState;
		},
		get canRecover() {
			return canRecover;
		},
		get pageVisible() {
			return pageVisible;
		},
		get pageOnline() {
			return pageOnline;
		},
		markRecovered,
		resetRecoveredConnection,
		start,
		dispose,
	};
}
