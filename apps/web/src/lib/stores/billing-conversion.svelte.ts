import type {
	BillingAccessWarning,
	BillingConversionIntent,
} from "@neta-art/cohub";

type BillingConversionLevel = "soft" | "hard";

type BillingConversionState = {
	open: boolean;
	level: BillingConversionLevel | null;
	intent: BillingConversionIntent | null;
	warning: BillingAccessWarning | null;
	dismissedSoftAt: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function isBillingConversionIntent(
	value: unknown,
): value is BillingConversionIntent {
	return (
		isRecord(value) &&
		(value.level === "soft" || value.level === "hard") &&
		typeof value.title === "string" &&
		typeof value.message === "string" &&
		isRecord(value.primaryAction) &&
		value.primaryAction.action === "open_billing_conversion"
	);
}

function extractIntentFromBody(body: unknown): BillingConversionIntent | null {
	if (!isRecord(body)) return null;
	const directBilling = isRecord(body.billing) ? body.billing : null;
	if (isBillingConversionIntent(directBilling?.conversion)) {
		return directBilling.conversion;
	}
	const error = isRecord(body.error) ? body.error : null;
	const details = isRecord(error?.details) ? error.details : null;
	if (isBillingConversionIntent(details?.conversion)) return details.conversion;
	return null;
}

function extractWarningFromBody(body: unknown): BillingAccessWarning | null {
	if (!isRecord(body)) return null;
	const billing = isRecord(body.billing) ? body.billing : null;
	if (billing?.status !== "allowed_with_debt") return null;
	if (!isBillingConversionIntent(billing.conversion)) return null;
	return billing as BillingAccessWarning;
}

export const BILLING_ACCESS_BLOCKED_CODE = "billing_credit_limit_exceeded";

export function isBillingAccessBlockedCode(value: string | null | undefined) {
	return value === BILLING_ACCESS_BLOCKED_CODE;
}

function defaultHardIntent(): BillingConversionIntent {
	return {
		level: "hard",
		reason: "negative_balance_limit_exceeded",
		audience: "unknown",
		preferredOfferKind: "mixed",
		title: "Add credits to continue",
		message: "Add credits or choose a plan to resume AI requests.",
		primaryAction: {
			label: "Add credits now",
			action: "open_billing_conversion",
		},
		source: "client_fallback",
	};
}

const SOFT_DISMISS_COOLDOWN_MS = 30 * 60 * 1000;

class BillingConversionStore {
	private state = $state<BillingConversionState>({
		open: false,
		level: null,
		intent: null,
		warning: null,
		dismissedSoftAt: null,
	});

	get open() {
		return this.state.open;
	}

	get level() {
		return this.state.level;
	}

	get intent() {
		return this.state.intent;
	}

	get warning() {
		return this.state.warning;
	}

	get hasSoftReminder() {
		return !!this.state.warning;
	}

	get isHardBlocked() {
		return this.state.level === "hard" && !!this.state.intent;
	}

	openFromIntent(intent: BillingConversionIntent) {
		this.state.intent = intent;
		this.state.level = intent.level;
		if (intent.level === "hard") this.state.dismissedSoftAt = null;
		this.state.open = true;
	}

	showSoft(warning: BillingAccessWarning) {
		this.state.warning = warning;
		this.state.intent = warning.conversion;
		this.state.level = "soft";
		const dismissedSoftAt = this.state.dismissedSoftAt;
		if (
			!dismissedSoftAt ||
			Date.now() - dismissedSoftAt >= SOFT_DISMISS_COOLDOWN_MS
		) {
			this.state.dismissedSoftAt = null;
			this.state.open = true;
		}
	}

	showHard(intent: BillingConversionIntent) {
		this.state.intent = intent;
		this.state.level = "hard";
		this.state.open = true;
	}

	close() {
		if (this.state.level === "soft") this.state.dismissedSoftAt = Date.now();
		this.state.open = false;
	}

	openReminder() {
		if (!this.state.intent) this.state.intent = defaultHardIntent();
		this.state.level = this.state.intent.level;
		this.state.open = true;
	}

	openFallbackHard() {
		this.showHard(
			this.state.intent?.level === "hard"
				? this.state.intent
				: defaultHardIntent(),
		);
	}

	clear() {
		this.state.open = false;
		this.state.level = null;
		this.state.intent = null;
		this.state.warning = null;
		this.state.dismissedSoftAt = null;
	}

	handleResponseBody(body: unknown) {
		const warning = extractWarningFromBody(body);
		if (warning) {
			this.showSoft(warning);
			return;
		}
		const intent = extractIntentFromBody(body);
		if (intent?.level === "hard") this.showHard(intent);
	}
}

export const billingConversion = new BillingConversionStore();
