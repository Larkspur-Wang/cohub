export type LocalUploadEntry = {
	file: File;
	relativePath: string;
};

const unsafePathPartPattern = /[<>:"/\\|?*]/;

export function sanitizeRelativePath(input: string) {
	if (typeof input !== "string" || input.length === 0 || input.length > 4096) {
		throw new Error("Invalid upload path.");
	}
	if (
		input !== input.trim() ||
		input.startsWith("/") ||
		/^[a-zA-Z]:/.test(input)
	) {
		throw new Error("Invalid upload path.");
	}
	const parts = input.split("/");
	if (parts.length === 0) throw new Error("Invalid upload path.");
	for (const part of parts) {
		if (
			!part ||
			part === "." ||
			part === ".." ||
			part.length > 255 ||
			part !== part.trim() ||
			unsafePathPartPattern.test(part) ||
			part.split("").some((char) => char.charCodeAt(0) <= 0x1f)
		) {
			throw new Error("Invalid upload path.");
		}
	}
	return parts.join("/");
}

type FileSystemEntryLike = {
	name: string;
	isFile: boolean;
	isDirectory: boolean;
};

type FileSystemFileEntryLike = FileSystemEntryLike & {
	file: (
		success: (file: File) => void,
		error?: (error: DOMException) => void,
	) => void;
};

type FileSystemDirectoryEntryLike = FileSystemEntryLike & {
	createReader: () => {
		readEntries: (
			success: (entries: FileSystemEntryLike[]) => void,
			error?: (error: DOMException) => void,
		) => void;
	};
};

type DataTransferItemWithEntry = DataTransferItem & {
	webkitGetAsEntry?: () => FileSystemEntryLike | null;
};

const fileFromEntry = (entry: FileSystemFileEntryLike) =>
	new Promise<File>((resolve, reject) => entry.file(resolve, reject));

const readDirectoryEntries = (entry: FileSystemDirectoryEntryLike) =>
	new Promise<FileSystemEntryLike[]>((resolve, reject) => {
		const reader = entry.createReader();
		const all: FileSystemEntryLike[] = [];
		const readBatch = () => {
			reader.readEntries((entries) => {
				if (entries.length === 0) {
					resolve(all);
					return;
				}
				all.push(...entries);
				readBatch();
			}, reject);
		};
		readBatch();
	});

const walkEntry = async (
	entry: FileSystemEntryLike,
	parentPath = "",
): Promise<LocalUploadEntry[]> => {
	const relativePath = sanitizeRelativePath(
		parentPath ? `${parentPath}/${entry.name}` : entry.name,
	);
	if (entry.isFile) {
		const file = await fileFromEntry(entry as FileSystemFileEntryLike);
		return [{ file, relativePath }];
	}
	if (entry.isDirectory) {
		const children = await readDirectoryEntries(
			entry as FileSystemDirectoryEntryLike,
		);
		const nested = await Promise.all(
			children.map((child) => walkEntry(child, relativePath)),
		);
		return nested.flat();
	}
	return [];
};

const fileRelativePath = (file: File) => {
	const maybePath = (file as File & { webkitRelativePath?: string })
		.webkitRelativePath;
	return sanitizeRelativePath(maybePath || file.name);
};

export const entriesFromFiles = (files: File[]) =>
	files.map((file) => ({ file, relativePath: fileRelativePath(file) }));

export const entriesFromDataTransfer = async (dataTransfer: DataTransfer) => {
	const itemEntries = Array.from(dataTransfer.items ?? []).reduce<
		FileSystemEntryLike[]
	>((acc, item) => {
		const entry = (item as DataTransferItemWithEntry).webkitGetAsEntry?.();
		if (entry) acc.push(entry);
		return acc;
	}, []);
	if (itemEntries.length > 0) {
		const nested = await Promise.all(
			itemEntries.map((entry) => walkEntry(entry)),
		);
		return nested.flat();
	}
	return entriesFromFiles(Array.from(dataTransfer.files ?? []));
};
