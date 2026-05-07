import { PUBLIC_API_ORIGIN } from "$env/static/public";
import { sdk } from "$lib/sdk";

export function buildSpaceFileDownloadUrl(spaceId: string, path: string) {
	const directUrl = sdk.space(spaceId).files.getDownloadUrl(path);
	const baseUrl = PUBLIC_API_ORIGIN ?? "";
	return `${baseUrl}${directUrl}`;
}

export async function downloadSpaceFile(
	spaceId: string,
	path: string,
	filename?: string,
) {
	const file = await sdk.space(spaceId).files.download(path);
	const objectUrl = URL.createObjectURL(file.blob);
	const link = document.createElement("a");
	link.href = objectUrl;
	link.download = filename ?? file.filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}
