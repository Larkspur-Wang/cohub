export type ImageGestureState = {
	zoom: number;
	panX: number;
	panY: number;
};

export type ImageGestureOptions = {
	getState: () => ImageGestureState;
	setState: (state: ImageGestureState) => void;
	minZoom?: number;
	maxZoom?: number;
	onDraggingChange?: (dragging: boolean) => void;
	onSwipe?: (deltaX: number, deltaY: number) => void;
};

type Point = { clientX: number; clientY: number };

type ActivePointer = Point & { pointerId: number };

function distance(a: Point, b: Point) {
	return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function midpoint(a: Point, b: Point): Point {
	return {
		clientX: (a.clientX + b.clientX) / 2,
		clientY: (a.clientY + b.clientY) / 2,
	};
}

/**
 * Shared image gesture state machine. The host owns state so it can keep
 * preview state local or persist it with the active file tab.
 */
export function createImageGestureHandlers(options: ImageGestureOptions) {
	const minZoom = options.minZoom ?? 0.25;
	const maxZoom = options.maxZoom ?? 4;
	const pointers = new Map<number, ActivePointer>();
	let pinchStart: {
		distance: number;
		zoom: number;
		panX: number;
		panY: number;
		center: Point;
	} | null = null;
	let panStart: {
		pointerId: number;
		clientX: number;
		clientY: number;
		panX: number;
		panY: number;
	} | null = null;
	let gestureStart: Point | null = null;

	function clampZoom(value: number) {
		return Math.min(maxZoom, Math.max(minZoom, value));
	}

	function clampPan(
		panX: number,
		panY: number,
		stage: HTMLElement,
		image: HTMLImageElement | null,
		zoom: number,
	) {
		if (!image) return { panX, panY };
		const maxX = Math.max(
			0,
			(image.offsetWidth * zoom - stage.clientWidth) / 2,
		);
		const maxY = Math.max(
			0,
			(image.offsetHeight * zoom - stage.clientHeight) / 2,
		);
		return {
			panX: Math.min(maxX, Math.max(-maxX, panX)),
			panY: Math.min(maxY, Math.max(-maxY, panY)),
		};
	}

	function setDragging(value: boolean) {
		options.onDraggingChange?.(value);
	}

	function clearPointer(pointerId: number, currentTarget: EventTarget | null) {
		pointers.delete(pointerId);
		const target = currentTarget as HTMLElement | null;
		if (target?.hasPointerCapture(pointerId))
			target.releasePointerCapture(pointerId);
	}

	function end() {
		pinchStart = null;
		panStart = null;
		setDragging(false);
	}

	function onPointerDown(event: PointerEvent) {
		if (event.pointerType === "mouse" && event.button !== 0) return;
		const stage = event.currentTarget as HTMLElement;
		const target = event.target as HTMLElement | null;
		if (target && target !== stage && target.tagName !== "IMG") return;

		stage.setPointerCapture(event.pointerId);
		pointers.set(event.pointerId, {
			pointerId: event.pointerId,
			clientX: event.clientX,
			clientY: event.clientY,
		});

		if (pointers.size === 1)
			gestureStart = { clientX: event.clientX, clientY: event.clientY };

		if (pointers.size === 2) {
			gestureStart = null;
			const [first, second] = [...pointers.values()];
			if (!first || !second) return;
			const state = options.getState();
			pinchStart = {
				distance: Math.max(1, distance(first, second)),
				zoom: state.zoom,
				panX: state.panX,
				panY: state.panY,
				center: midpoint(first, second),
			};
			panStart = null;
			setDragging(false);
			return;
		}

		const state = options.getState();
		if (state.zoom > 1) {
			event.preventDefault();
			panStart = {
				pointerId: event.pointerId,
				clientX: event.clientX,
				clientY: event.clientY,
				panX: state.panX,
				panY: state.panY,
			};
			setDragging(true);
		}
	}

	function onPointerMove(event: PointerEvent) {
		const active = pointers.get(event.pointerId);
		if (!active) return;
		active.clientX = event.clientX;
		active.clientY = event.clientY;

		const stage = event.currentTarget as HTMLElement;
		const image = stage.querySelector<HTMLImageElement>("img");
		const state = options.getState();

		if (pointers.size >= 2 && pinchStart) {
			const [first, second] = [...pointers.values()];
			if (!first || !second) return;
			event.preventDefault();
			const nextZoom = clampZoom(
				pinchStart.zoom * (distance(first, second) / pinchStart.distance),
			);
			const focus = midpoint(first, second);
			const rect = stage.getBoundingClientRect();
			const centerX = rect.left + rect.width / 2;
			const centerY = rect.top + rect.height / 2;
			const imagePointX =
				(pinchStart.center.clientX - centerX - pinchStart.panX) /
				pinchStart.zoom;
			const imagePointY =
				(pinchStart.center.clientY - centerY - pinchStart.panY) /
				pinchStart.zoom;
			const nextPan = clampPan(
				focus.clientX - centerX - imagePointX * nextZoom,
				focus.clientY - centerY - imagePointY * nextZoom,
				stage,
				image,
				nextZoom,
			);
			options.setState({ zoom: nextZoom, ...nextPan });
			setDragging(false);
			return;
		}

		if (!panStart || panStart.pointerId !== event.pointerId || state.zoom <= 1)
			return;
		event.preventDefault();
		options.setState({
			zoom: state.zoom,
			...clampPan(
				panStart.panX + event.clientX - panStart.clientX,
				panStart.panY + event.clientY - panStart.clientY,
				stage,
				image,
				state.zoom,
			),
		});
	}

	function finishPointer(event: PointerEvent, allowSwipe: boolean) {
		const start = gestureStart;
		clearPointer(event.pointerId, event.currentTarget);
		if (pointers.size === 1 && options.getState().zoom > 1) {
			const remaining = [...pointers.values()][0];
			if (remaining) {
				const state = options.getState();
				panStart = {
					pointerId: remaining.pointerId,
					clientX: remaining.clientX,
					clientY: remaining.clientY,
					panX: state.panX,
					panY: state.panY,
				};
				setDragging(true);
				pinchStart = null;
				return;
			}
		}
		if (pointers.size === 0) {
			const swipePointer =
				event.pointerType === "touch" || event.pointerType === "pen";
			if (allowSwipe && swipePointer && start && options.getState().zoom <= 1) {
				const deltaX = event.clientX - start.clientX;
				const deltaY = event.clientY - start.clientY;
				if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
					options.onSwipe?.(deltaX, deltaY);
				}
			}
			gestureStart = null;
			end();
		}
	}

	function onPointerUp(event: PointerEvent) {
		finishPointer(event, true);
	}

	function onPointerCancel(event: PointerEvent) {
		finishPointer(event, false);
	}

	function reset() {
		pointers.clear();
		gestureStart = null;
		end();
	}

	return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, reset };
}
