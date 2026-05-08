import { PUBLIC_API_ORIGIN } from "$env/static/public";

export type UserProfile = {
	userUuid: string;
	displayName: string;
	avatarUrl: string | null;
};

export type TrendingRow = {
	rank: number;
	totalTokens: number;
	costTotal: number;
	sessionCount: number;
	requestCount: number;
};

export type SpaceRow = TrendingRow & {
	spaceId: string;
	spaceName: string;
	userId: string;
	userDisplay: string;
	userProfile: UserProfile;
};

export type UserRow = TrendingRow & {
	userId: string;
	userDisplay: string;
	userProfile: UserProfile;
};

export type ModelRow = TrendingRow & {
	provider: string;
	model: string;
	modelDisplay: string;
};

function buildUrl(path: string) {
	const base = PUBLIC_API_ORIGIN ?? "";
	return `${base}/api/trending${path}`;
}

export async function fetchSpaces(): Promise<SpaceRow[]> {
	const res = await fetch(buildUrl("/spaces"));
	if (!res.ok) return [];
	return res.json();
}

export async function fetchUsers(): Promise<UserRow[]> {
	const res = await fetch(buildUrl("/users"));
	if (!res.ok) return [];
	return res.json();
}

export async function fetchModels(): Promise<ModelRow[]> {
	const res = await fetch(buildUrl("/models"));
	if (!res.ok) return [];
	return res.json();
}
