export type RouteRequestGuard = {
	isCurrent: () => boolean;
};

export function createRouteRequestGuard<TSnapshot>(options: {
	capture: () => TSnapshot;
	isEqual: (current: TSnapshot, captured: TSnapshot) => boolean;
}): RouteRequestGuard {
	const captured = options.capture();
	return {
		isCurrent: () => options.isEqual(options.capture(), captured),
	};
}

export function createKeyedRouteRequestGuard(options: {
	captureKey: () => string;
}): RouteRequestGuard {
	const capturedKey = options.captureKey();
	return {
		isCurrent: () => options.captureKey() === capturedKey,
	};
}
