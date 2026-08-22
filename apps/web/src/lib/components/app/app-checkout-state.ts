export type AppCheckoutStateStatus = "success" | "failed" | "cancel" | null;

export type AppCheckoutState = {
	status: AppCheckoutStateStatus;
	orderId: string | null;
};

export function readAppCheckoutState(url: URL): AppCheckoutState {
	const value = url.searchParams.get("cohub_checkout");
	const status =
		value === "success" || value === "failed" || value === "cancel"
			? value
			: null;
	const orderId = url.searchParams.get("cohub_order")?.trim() || null;
	return { status, orderId };
}
