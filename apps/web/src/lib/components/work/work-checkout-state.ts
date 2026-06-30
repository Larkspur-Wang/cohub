export type WorkCheckoutStateStatus = "success" | "failed" | "cancel" | null;

export type WorkCheckoutState = {
	status: WorkCheckoutStateStatus;
	orderId: string | null;
};

export function readWorkCheckoutState(url: URL): WorkCheckoutState {
	const value = url.searchParams.get("cohub_checkout");
	const status =
		value === "success" || value === "failed" || value === "cancel"
			? value
			: null;
	const orderId = url.searchParams.get("cohub_order")?.trim() || null;
	return { status, orderId };
}
