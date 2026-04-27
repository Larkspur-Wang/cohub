type RecoveryCoordinatorOptions = {
	isTransportOpen: () => boolean;
	reconcileSessionTail: (sessionId: string) => Promise<void>;
	refreshSessionsList: () => Promise<void>;
	onRecovered?: () => void;
};

export class SessionRecoveryCoordinator {
	private fallbackTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly options: RecoveryCoordinatorOptions) {}

	clear() {
		if (!this.fallbackTimer) return;
		clearTimeout(this.fallbackTimer);
		this.fallbackTimer = null;
	}

	onTransportOpen() {
		this.clear();
		this.options.onRecovered?.();
	}

	scheduleFallbackSync(sessionId: string, attempt = 0) {
		this.clear();
		if (this.options.isTransportOpen()) return;
		if (attempt >= 20) return;
		this.fallbackTimer = setTimeout(
			() => {
				this.fallbackTimer = null;
				if (this.options.isTransportOpen()) return;
				void this.options
					.reconcileSessionTail(sessionId)
					.catch(() => undefined)
					.finally(() => {
						void this.options.refreshSessionsList().catch(() => undefined);
						this.scheduleFallbackSync(sessionId, attempt + 1);
					});
			},
			attempt === 0 ? 1200 : 1500,
		);
	}

	async reconcileAfterReconnect(sessionId: string | null | undefined) {
		this.clear();
		if (!sessionId) return;
		await this.options.reconcileSessionTail(sessionId);
		await this.options.refreshSessionsList();
	}

	async reconcileAfterSendWhileOffline(sessionId: string) {
		await this.options.reconcileSessionTail(sessionId);
	}

	dispose() {
		this.clear();
	}
}
