import type { SpaceFsFileResponse } from "@neta-art/cohub";

type PreviewableFile = Pick<SpaceFsFileResponse, "mimeType" | "path">;

function normalizeMimeType(mimeType: string | null | undefined) {
	return mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function isPdfFile(file: PreviewableFile | null | undefined): boolean {
	if (!file) return false;
	if (normalizeMimeType(file.mimeType) === "application/pdf") return true;
	return /(?:^|\/)\.?[^/]+\.pdf$/i.test(file.path);
}
