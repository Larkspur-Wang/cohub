import { z } from "zod";
import {
	BOARD_ARROW_STROKE_SIZE,
	BOARD_CONNECTION_STROKE_SIZE,
} from "../board-constants.js";

const idSchema = z.string().min(1).max(160);
const finiteSchema = z.number().finite();

export const BoardAwarenessPointSchema = z.object({
	x: finiteSchema,
	y: finiteSchema,
});

export const BoardAwarenessDrawPointSchema = BoardAwarenessPointSchema.extend({
	p: finiteSchema.min(0).max(1),
});

export const BoardAwarenessFrameSchema = z.object({
	x: finiteSchema,
	y: finiteSchema,
	width: finiteSchema.positive(),
	height: finiteSchema.positive(),
	rotation: finiteSchema,
});

export const BoardAwarenessNodePreviewSchema = z.object({
	nodeId: idSchema,
	frame: BoardAwarenessFrameSchema,
	/** Live endpoints of a free arrow being dragged. */
	arrow: z
		.object({
			start: BoardAwarenessPointSchema,
			end: BoardAwarenessPointSchema,
			bend: finiteSchema,
		})
		.optional(),
});

export const BoardAwarenessStateUpdateSchema = z.object({
	type: z.literal("state"),
	client: z
		.object({
			formFactor: z.enum(["desktop", "mobile"]),
		})
		.optional(),
	cursor: BoardAwarenessPointSchema.extend({
		pointerType: z.enum(["mouse", "pen", "touch"]),
	})
		.nullable(),
	tool: z.string().min(1).max(40),
	selection: z.object({
		ids: z.array(idSchema).max(64),
		count: z.number().int().nonnegative().max(50_000),
		bounds: BoardAwarenessFrameSchema.nullable(),
	}),
	editingId: idSchema.nullable(),
});

export const BoardAwarenessGestureSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("draw"),
		id: idSchema,
		nodeId: idSchema,
		color: z.string().min(1).max(64),
		size: finiteSchema.positive().max(256),
		from: z.number().int().nonnegative().max(100_000),
		points: z.array(BoardAwarenessDrawPointSchema).min(1).max(64),
	}),
	z.object({
		kind: z.literal("arrow"),
		id: idSchema,
		nodeId: idSchema,
		start: BoardAwarenessPointSchema,
		current: BoardAwarenessPointSchema,
		color: z.string().min(1).max(64),
		size: finiteSchema
			.positive()
			.max(256)
			.default(BOARD_ARROW_STROKE_SIZE),
	}),
	z.object({
		kind: z.literal("box"),
		id: idSchema,
		nodeId: idSchema,
		shape: z.enum(["geo", "frame"]),
		start: BoardAwarenessPointSchema,
		current: BoardAwarenessPointSchema,
		color: z.string().min(1).max(64),
		geo: z.string().min(1).max(40),
	}),
	/**
	 * A relation being drawn.
	 *
	 * Carries the anchor node and the live pointer rather than a partial
	 * connection: until the gesture lands on a target there is no relation to
	 * describe, and sending a half-built one would put an invalid connection on the
	 * wire. `targetNodeId` is set once the pointer is over a candidate, which is
	 * what lets peers see the same snap the author sees.
	 */
	z.object({
		kind: z.literal("connection"),
		id: idSchema,
		sourceNodeId: idSchema,
		targetNodeId: idSchema.nullable(),
		current: BoardAwarenessPointSchema,
		color: z.string().min(1).max(64),
		size: finiteSchema.positive().max(256).default(BOARD_CONNECTION_STROKE_SIZE),
	}),
	z.object({
		kind: z.literal("transform"),
		id: idSchema,
		mode: z.enum(["translate", "resize", "rotate", "arrow", "connection"]),
		nodes: z.array(BoardAwarenessNodePreviewSchema).max(64),
		bounds: BoardAwarenessFrameSchema.nullable(),
	}),
]);

export const BoardAwarenessUpdateSchema = z.discriminatedUnion("type", [
	BoardAwarenessStateUpdateSchema,
	z.object({
		type: z.literal("gesture"),
		gesture: BoardAwarenessGestureSchema,
	}),
	z.object({
		type: z.literal("gesture.end"),
		gestureId: idSchema,
		resultingNodeIds: z.array(idSchema).max(64),
	}),
	z.object({
		type: z.literal("gesture.cancel"),
		gestureId: idSchema,
	}),
]);

export const BoardAwarenessClientPayloadSchema = z.object({
	spaceId: z.string().uuid(),
	boardId: z.string().uuid(),
	seq: z.number().int().nonnegative(),
	update: BoardAwarenessUpdateSchema,
});

export type BoardAwarenessPoint = z.infer<typeof BoardAwarenessPointSchema>;
export type BoardAwarenessDrawPoint = z.infer<
	typeof BoardAwarenessDrawPointSchema
>;
export type BoardAwarenessFrame = z.infer<typeof BoardAwarenessFrameSchema>;
export type BoardAwarenessNodePreview = z.infer<
	typeof BoardAwarenessNodePreviewSchema
>;
export type BoardAwarenessStateUpdate = z.infer<
	typeof BoardAwarenessStateUpdateSchema
>;
export type BoardAwarenessGesture = z.infer<
	typeof BoardAwarenessGestureSchema
>;
export type BoardAwarenessUpdate = z.infer<typeof BoardAwarenessUpdateSchema>;
export type BoardAwarenessClientPayload = z.infer<
	typeof BoardAwarenessClientPayloadSchema
>;
