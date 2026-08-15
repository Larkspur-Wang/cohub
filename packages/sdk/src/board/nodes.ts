import type {
	BoardNodeInput,
	BoardNodeValidationDiagnostic,
} from "@cohub/protocol";
import {
	BOARD_ARROW_STROKE_SIZE,
	BOARD_DRAW_STROKE_SIZE,
	BOARD_TEXT_FONT_SIZE,
} from "@cohub/protocol/board-constants";
import type {
	BoardAudioItem,
	BoardFileSnapshot,
	BoardMediaSnapshot,
	BoardTaskSnapshot,
} from "@cohub/protocol/board-document";
import {
	type BoardColorId,
	type BoardGeoKind,
	validateBoardNodeInput,
} from "@cohub/protocol";
import { computeDrawBounds } from "./core/draw-geometry.js";

export type BoardNodeFrameInput = {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation?: number;
};

type BoardNodeSpecBase = {
	id: string;
	parentId?: string | null;
	orderKey?: string | null;
	style?: Record<string, unknown>;
};

type BoardBoxNodeSpec = BoardNodeSpecBase & { frame: BoardNodeFrameInput };
type BoardMediaNodeSpec = BoardBoxNodeSpec & {
	path: string;
	snapshot?: BoardMediaSnapshot;
};

export type BoardNodeSpec =
	| (BoardBoxNodeSpec & {
			type: "text";
			text?: string;
			color?: BoardColorId;
			fontSize?: number;
	  })
	| (BoardBoxNodeSpec & {
			type: "geo";
			geo?: BoardGeoKind;
			text?: string;
			color?: BoardColorId;
			fillOpacity?: number;
	  })
	| (BoardNodeSpecBase & {
			type: "draw";
			/** Raw world-space samples. Stored points are converted to frame-local space. */
			points: Array<{ x: number; y: number; p?: number }>;
			color?: BoardColorId;
			size?: number;
	  })
	| (BoardNodeSpecBase & {
			type: "arrow";
			start: { x: number; y: number };
			end: { x: number; y: number };
			bend?: number;
			color?: BoardColorId;
			size?: number;
			arrowStart?: boolean;
			arrowEnd?: boolean;
			label?: string;
	  })
	| (BoardBoxNodeSpec & {
			type: "frame";
			label?: string;
			color?: BoardColorId;
	  })
	| (BoardMediaNodeSpec & {
			type: "image";
			crop?: { x: number; y: number; w: number; h: number };
	  })
	| (BoardMediaNodeSpec & { type: "video" })
	| (Omit<BoardMediaNodeSpec, "snapshot"> & {
			type: "audio";
			snapshot?: BoardAudioItem["snapshot"];
	  })
	| (BoardBoxNodeSpec & {
			type: "file";
			path: string;
			snapshot?: BoardFileSnapshot;
	  })
	| (BoardBoxNodeSpec & {
			type: "task";
			taskRunId: string;
			snapshot: BoardTaskSnapshot;
	  });

export class BoardInputError extends Error {
	readonly code = "INVALID_BOARD_NODE";
	readonly diagnostics: BoardNodeValidationDiagnostic[];
	readonly body: {
		code: "INVALID_BOARD_NODE";
		message: string;
		diagnostics: BoardNodeValidationDiagnostic[];
	};

	constructor(diagnostics: BoardNodeValidationDiagnostic[]) {
		const message = diagnostics[0]?.message ?? "Invalid Board node";
		super(message);
		this.name = "BoardInputError";
		this.diagnostics = diagnostics;
		this.body = { code: this.code, message, diagnostics };
	}
}

function baseNode(
	spec: BoardNodeSpecBase & { type: string },
	frame: BoardNodeFrameInput,
): BoardNodeInput {
	return {
		nodeId: spec.id,
		type: spec.type,
		parentId: spec.parentId ?? null,
		orderKey: spec.orderKey ?? null,
		x: frame.x,
		y: frame.y,
		width: frame.width,
		height: frame.height,
		rotation: frame.rotation ?? 0,
		refKind: null,
		refPath: null,
		refUrl: null,
		view: {},
		style: spec.style ?? {},
		data: {},
	};
}

function arrowFrame(
	start: { x: number; y: number },
	end: { x: number; y: number },
): BoardNodeFrameInput {
	const padding = 16;
	return {
		x: Math.min(start.x, end.x) - padding,
		y: Math.min(start.y, end.y) - padding,
		width: Math.max(1, Math.abs(end.x - start.x) + padding * 2),
		height: Math.max(1, Math.abs(end.y - start.y) + padding * 2),
	};
}

/**
 * Create one validated wire node from semantic Board input.
 *
 * Box nodes take an explicit world-space frame. Draw samples and arrow endpoints
 * take world coordinates; the builder derives their frame and local storage form.
 */
export function createBoardNode(spec: BoardNodeSpec): BoardNodeInput {
	let node: BoardNodeInput;
	if (spec.type === "draw") {
		const size = spec.size ?? BOARD_DRAW_STROKE_SIZE;
		const worldPoints = spec.points.map((point) => ({
			x: point.x,
			y: point.y,
			p: point.p ?? 0.5,
		}));
		const bounds = computeDrawBounds(worldPoints, size);
		node = baseNode(spec, bounds);
		node.data = {
			points: worldPoints.map((point) => ({
				x: point.x - bounds.x,
				y: point.y - bounds.y,
				p: point.p,
			})),
			color: spec.color ?? "brand",
			size,
		};
	} else if (spec.type === "arrow") {
		node = baseNode(spec, arrowFrame(spec.start, spec.end));
		node.data = {
			start: spec.start,
			end: spec.end,
			bend: spec.bend ?? 0,
			color: spec.color ?? "brand",
			size: spec.size ?? BOARD_ARROW_STROKE_SIZE,
			arrowStart: spec.arrowStart ?? false,
			arrowEnd: spec.arrowEnd ?? true,
			label: spec.label ?? "",
		};
	} else {
		node = baseNode(spec, spec.frame);
		switch (spec.type) {
			case "text":
				node.data = {
					text: spec.text ?? "",
					color: spec.color ?? "neutral",
					fontSize: spec.fontSize ?? BOARD_TEXT_FONT_SIZE,
				};
				break;
			case "geo":
				node.data = {
					geo: spec.geo ?? "rectangle",
					text: spec.text ?? "",
					color: spec.color ?? "brand",
					fillOpacity: spec.fillOpacity ?? 0,
				};
				break;
			case "frame":
				node.data = {
					label: spec.label ?? "Frame",
					color: spec.color ?? "neutral",
				};
				break;
			case "image":
				node.refKind = "space_file";
				node.refPath = spec.path;
				node.view = spec.snapshot ?? {};
				node.data = spec.crop ? { crop: spec.crop } : {};
				break;
			case "video":
			case "audio":
				node.refKind = "space_file";
				node.refPath = spec.path;
				node.view = spec.snapshot ?? {};
				break;
			case "file":
				node.refKind = "space_file";
				node.refPath = spec.path;
				node.view = spec.snapshot ?? {};
				break;
			case "task":
				node.view = spec.snapshot;
				node.data = { taskRunId: spec.taskRunId };
				break;
		}
	}
	assertBoardNodes([node]);
	return node;
}

export function validateBoardNodes(
	nodes: readonly BoardNodeInput[],
	path = "nodes",
): BoardNodeValidationDiagnostic[] {
	return nodes.flatMap((node, index) =>
		validateBoardNodeInput(node, `${path}.${index}`),
	);
}

export function assertBoardNodes(
	nodes: readonly BoardNodeInput[],
	path = "nodes",
): void {
	const diagnostics = validateBoardNodes(nodes, path);
	if (diagnostics.length > 0) throw new BoardInputError(diagnostics);
}

export function assertBoardTransactionNodeCreates(
	operations: ReadonlyArray<{ type: string; payload: unknown }>,
): void {
	const diagnostics = operations.flatMap((operation, index) => {
		if (operation.type !== "node.create") return [];
		const payload = operation.payload as { node?: BoardNodeInput };
		return payload.node
			? validateBoardNodeInput(payload.node, `operations.${index}.payload.node`)
			: [];
	});
	if (diagnostics.length > 0) throw new BoardInputError(diagnostics);
}
