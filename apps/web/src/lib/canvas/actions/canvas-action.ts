import type { Container } from "pixi.js";
import type { CovasDocument } from "$lib/canvas/canvas-schema";

export type CanvasActionContext = {
	document: CovasDocument;
	selectedItemIds: string[];
	stage?: Container;
	updateDocument: (document: CovasDocument) => void;
};

export type CanvasAction = {
	id: string;
	label: string;
	canRun: (context: CanvasActionContext) => boolean;
	run: (context: CanvasActionContext) => void | Promise<void>;
};
