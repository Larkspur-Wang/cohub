import type { ContentBlock } from "@neta-art/cohub-protocol/core";

export const MAX_COMPOSER_ATTACHMENTS = 14;
export const MAX_COMPOSER_TEXT_ATTACHMENT_BYTES = 200 * 1024;

export const COMPOSER_ATTACHMENT_ACCEPT = [
	"image/*",
	"text/*",
	"application/json",
	"application/xml",
	"application/yaml",
	"application/x-yaml",
	"application/javascript",
	"application/typescript",
	"application/x-typescript",
	"application/sql",
	".txt",
	".md",
	".markdown",
	".mdown",
	".mkdn",
	".json",
	".jsonc",
	".yaml",
	".yml",
	".csv",
	".log",
	".toml",
	".ini",
	".env",
	".xml",
	".html",
	".htm",
	".css",
	".js",
	".mjs",
	".cjs",
	".ts",
	".tsx",
	".jsx",
	".py",
	".sh",
	".bash",
	".zsh",
	".sql",
	".graphql",
	".gql",
	".go",
	".rs",
	".java",
	".rb",
	".php",
	".c",
	".cpp",
	".h",
	".hpp",
].join(",");

export type ComposerImageAttachment = {
	kind: "image";
	id: string;
	name: string;
	mediaType: string;
	data: string;
	previewUrl: string;
	size: number;
};

export type ComposerTextAttachment = {
	kind: "text";
	id: string;
	name: string;
	mediaType: string;
	text: string;
	size: number;
};

export type ComposerAttachment =
	| ComposerImageAttachment
	| ComposerTextAttachment;

const supportedTextExtensions = new Set([
	"txt",
	"md",
	"markdown",
	"mdown",
	"mkdn",
	"json",
	"jsonc",
	"yaml",
	"yml",
	"csv",
	"log",
	"toml",
	"ini",
	"env",
	"xml",
	"html",
	"htm",
	"css",
	"js",
	"mjs",
	"cjs",
	"ts",
	"tsx",
	"jsx",
	"py",
	"sh",
	"bash",
	"zsh",
	"sql",
	"graphql",
	"gql",
	"go",
	"rs",
	"java",
	"rb",
	"php",
	"c",
	"cpp",
	"h",
	"hpp",
]);

const supportedTextMimeTypes = new Set([
	"text/plain",
	"text/markdown",
	"text/csv",
	"text/html",
	"text/css",
	"text/javascript",
	"application/json",
	"application/ld+json",
	"application/xml",
	"application/yaml",
	"application/x-yaml",
	"application/javascript",
	"application/typescript",
	"application/x-typescript",
	"application/sql",
]);

function getFileExtension(name: string) {
	const lastDot = name.lastIndexOf(".");
	if (lastDot === -1) return "";
	return name.slice(lastDot + 1).toLowerCase();
}

export function createComposerAttachmentId(file: File) {
	return `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isSupportedComposerAttachmentFile(file: File) {
	if (file.type.startsWith("image/")) return true;
	if (supportedTextMimeTypes.has(file.type)) return true;
	return supportedTextExtensions.has(getFileExtension(file.name));
}

export function isComposerImageFile(file: File) {
	return file.type.startsWith("image/");
}

export async function readComposerTextAttachment(
	file: File,
): Promise<ComposerTextAttachment> {
	if (file.size > MAX_COMPOSER_TEXT_ATTACHMENT_BYTES) {
		throw new Error(`Text file "${file.name}" exceeds 200 KB.`);
	}
	const text = await file.text();
	return {
		kind: "text",
		id: createComposerAttachmentId(file),
		name: file.name,
		mediaType: file.type || "text/plain",
		text,
		size: file.size,
	};
}

export function buildComposerTextContentBlock(
	attachment: ComposerTextAttachment,
): ContentBlock {
	return {
		type: "text",
		text: `[File: ${attachment.name}]\n${attachment.text}`,
		_meta: {
			filename: attachment.name,
			mediaType: attachment.mediaType,
			attachmentKind: "text",
			size: attachment.size,
		},
	};
}
