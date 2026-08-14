import type { PublicGenerationDeclaration } from "@cohub/protocol/generation";

const MODEL_SCHEMA = "neta.generation.model.v1";
const CONTENT_TYPES = new Set(["text", "image", "video", "audio"]);
const SOURCE_TYPES = new Set(["url", "base64"]);
const MERGE_TYPES = new Set(["newline", "space", "concat"]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown) {
	return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown) {
	return value === undefined || typeof value === "boolean";
}

function isOptionalNumber(value: unknown) {
	return (
		value === undefined || (typeof value === "number" && Number.isFinite(value))
	);
}

function isTypedArray(value: unknown, type: "string" | "number" | "boolean") {
	return (
		value === undefined ||
		(Array.isArray(value) &&
			value.every(
				(item) =>
					typeof item === type && (type !== "number" || Number.isFinite(item)),
			))
	);
}

function isDimensionsSpec(value: unknown) {
	if (!isRecord(value)) return false;
	return (
		(value.separator === undefined ||
			value.separator === "x" ||
			value.separator === "*") &&
		isOptionalNumber(value.min) &&
		isOptionalNumber(value.max) &&
		isOptionalNumber(value.multipleOf)
	);
}

function hasValidParameterCommon(spec: UnknownRecord) {
	return isOptionalBoolean(spec.optional) && isOptionalString(spec.description);
}

function isParameterSpec(value: unknown): boolean {
	if (!isRecord(value) || !hasValidParameterCommon(value)) return false;

	switch (value.type) {
		case "string":
			return (
				isOptionalString(value.default) &&
				isTypedArray(value.enum, "string") &&
				isTypedArray(value.examples, "string") &&
				(value.dimensions === undefined ||
					isDimensionsSpec(value.dimensions)) &&
				value.min === undefined &&
				value.max === undefined
			);
		case "number":
		case "integer":
			return (
				isOptionalNumber(value.default) &&
				isOptionalNumber(value.min) &&
				isOptionalNumber(value.max) &&
				isTypedArray(value.examples, "number") &&
				value.enum === undefined &&
				value.dimensions === undefined
			);
		case "boolean":
			return (
				isOptionalBoolean(value.default) &&
				isTypedArray(value.examples, "boolean") &&
				value.enum === undefined &&
				value.dimensions === undefined &&
				value.min === undefined &&
				value.max === undefined
			);
		default:
			return false;
	}
}

function isContentSpec(value: unknown): boolean {
	if (!isRecord(value) || !CONTENT_TYPES.has(value.type as string)) {
		return false;
	}
	return (
		isOptionalBoolean(value.required) &&
		isOptionalBoolean(value.roleRequired) &&
		isOptionalNumber(value.min) &&
		isOptionalNumber(value.max) &&
		isOptionalString(value.description) &&
		(value.sources === undefined ||
			(Array.isArray(value.sources) &&
				value.sources.every((source) => SOURCE_TYPES.has(source as string)))) &&
		isTypedArray(value.roles, "string") &&
		(value.merge === undefined || MERGE_TYPES.has(value.merge as string)) &&
		(value.meta === undefined || isRecord(value.meta))
	);
}

function isMetaFieldSpec(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (value.type !== "object") return isParameterSpec(value);
	return (
		isOptionalBoolean(value.optional) && isOptionalString(value.description)
	);
}

function isMetaSpec(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (
		value.fields !== undefined &&
		(!isRecord(value.fields) ||
			!Object.values(value.fields).every(isMetaFieldSpec))
	) {
		return false;
	}
	if (!isOptionalString(value.taskField)) return false;
	if (value.taskVariants === undefined) return true;
	if (!isRecord(value.taskVariants)) return false;
	return Object.values(value.taskVariants).every((variant) => {
		if (!isRecord(variant) || !isOptionalString(variant.description)) {
			return false;
		}
		return (
			isTypedArray(variant.required, "string") &&
			(variant.requiredContent === undefined ||
				(Array.isArray(variant.requiredContent) &&
					variant.requiredContent.every((type) =>
						CONTENT_TYPES.has(type as string),
					))) &&
			isOptionalBoolean(variant.sendTask)
		);
	});
}

export function isValidCachedGenerationModel(
	value: unknown,
): value is PublicGenerationDeclaration {
	if (!isRecord(value) || value.schema !== MODEL_SCHEMA) return false;
	if (typeof value.model !== "string" || value.model.trim() === "") {
		return false;
	}
	if (
		!isOptionalString(value.title) ||
		!isOptionalString(value.description) ||
		!isOptionalBoolean(value.hidden) ||
		!isOptionalBoolean(value.allowUnknownParameters)
	) {
		return false;
	}
	if (!isRecord(value.content) || !Array.isArray(value.content.input)) {
		return false;
	}
	if (!value.content.input.every(isContentSpec)) return false;
	if (
		value.parameters !== undefined &&
		(!isRecord(value.parameters) ||
			!Object.values(value.parameters).every(isParameterSpec))
	) {
		return false;
	}
	if (value.meta !== undefined && !isMetaSpec(value.meta)) return false;
	return value.examples === undefined || Array.isArray(value.examples);
}

export function isModelList(
	value: unknown,
): value is PublicGenerationDeclaration[] {
	return Array.isArray(value) && value.every(isValidCachedGenerationModel);
}
