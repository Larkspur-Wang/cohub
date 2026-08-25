export function isBrowserManagedUploadHeader(name: string) {
	return name.toLowerCase() === "content-length";
}
