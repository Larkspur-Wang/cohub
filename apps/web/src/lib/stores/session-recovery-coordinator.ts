type RecoveryCoordinatorOptions = {
	isTransportOpen: () => boolean;
	reconcileSessionTail: (sessionId: string) => Promise<void>;
	refreshSessionsList: () => Promise<void>;
	onRecovered?: () => void;
	onExhausted?: (sessionId: string) => void;
};

export class SessionRecoveryCoordinator {
	private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
	private disposed = false;

	constructor(private readonly options: RecoveryCoordinatorOptions) {}

	clear() {
		if (!this.fallbackTimer) return;
		clearTimeout(this.fallbackTimer);
		this.fallbackTimer = null;
	}

	onTransportOpen() {
		this.disposed = false;
		this.clear();
		this.options.onRecovered?.();
	}

	scheduleFallbackSync(sessionId: string, attempt = 0) {
		this.clear();
		if (this.disposed) return;
		if (this.options.isTransportOpen()) return;
		if (attempt >= 20) {
			this.options.onExhausted?.(sessionId);
			return;
		}
		this.fallbackTimer = setTimeout(
			() => {
				this.fallbackTimer = null;
				if (this.disposed || this.options.isTransportOpen()) return;
				void this.options
					.reconcileSessionTail(sessionId)
					.catch(() => undefined)
					.finally(() => {
						if (this.disposed) return;
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
		this.disposed = true;
		this.clear();
	}
}
