type AvatarImageSize = "xxs" | "xs" | "sm" | "md" | "lg" | "xl" | number;

const AVATAR_WIDTHS: Record<Exclude<AvatarImageSize, number>, number> = {
	xxs: 48,
	xs: 64,
	sm: 96,
	md: 128,
	lg: 192,
	xl: 320,
};

function isInlineMediaUrl(value: string) {
	return /^(data|blob):/i.test(value);
}

function widthForSize(size: AvatarImageSize) {
	return typeof size === "number" ? size : AVATAR_WIDTHS[size];
}

export function withOssImageProcess(
	src: string | null | undefined,
	process: string,
) {
	const value = src?.trim();
	if (!value) return "";
	if (isInlineMediaUrl(value)) return value;
	if (/[?&]x-oss-process=/.test(value)) return value;

	const hashIndex = value.indexOf("#");
	const base = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
	const hash = hashIndex >= 0 ? value.slice(hashIndex) : "";
	const separator = base.includes("?") ? "&" : "?";
	return `${base}${separator}x-oss-process=${process}${hash}`;
}

export function avatarImageUrl(
	src: string | null | undefined,
	size: AvatarImageSize = "md",
) {
	const width = widthForSize(size);
	const quality = width >= 256 ? 84 : 82;
	return withOssImageProcess(
		src,
		`image/resize,w_${width}/quality,q_${quality}/format,webp`,
	);
}
