export type BoardToolId =
	| "select"
	| "hand"
	| "text"
	| "geo"
	| "draw"
	| "arrow"
	| "frame";

export function isContinuousBoardTool(tool: BoardToolId): boolean {
	return tool === "draw";
}
