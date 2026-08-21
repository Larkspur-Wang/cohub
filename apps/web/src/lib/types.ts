export type RepositoryEntry = {
	name: string;
	path: string;
	type: "file" | "dir" | "symlink" | "submodule";
	size: number;
	sha: string;
};

export type RepositoryTreeNode = RepositoryEntry & {
	children: RepositoryTreeNode[];
	isOpen: boolean;
	isLoaded: boolean;
	isLoading: boolean;
};

export type RepositoryFile = {
	name: string;
	path: string;
	sha: string;
	size: number;
	encoding: string;
	content: string;
};

export type RepositoryInfo = {
	id: string;
	name: string;
	description: string;
};

export type SpaceSummary = {
	id: string;
	spaceId: string;
	status: string;
};
