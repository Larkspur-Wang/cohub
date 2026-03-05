import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const getBffOrigin = () => {
	const origin = env.BFF_ORIGIN;
	if (!origin) {
		throw new Error('Missing env: BFF_ORIGIN');
	}
	return origin.replace(/\/$/, '');
};

const hopByHopHeaders = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailers',
	'upgrade'
]);

const filterHeaders = (headers: Headers) => {
	const out = new Headers();
	for (const [key, value] of headers.entries()) {
		if (hopByHopHeaders.has(key.toLowerCase())) continue;
		out.set(key, value);
	}
	return out;
};

const proxy = async ({ request, params, fetch }: { request: Request; params: { path?: string }; fetch: typeof globalThis.fetch }) => {
	const path = params.path ?? '';
	const url = new URL(request.url);
	const target = `${getBffOrigin()}/api/${path}${url.search}`;

	const init: RequestInit = {
		method: request.method,
		headers: filterHeaders(request.headers)
	};

	if (request.method !== 'GET' && request.method !== 'HEAD') {
		init.body = await request.arrayBuffer();
	}

	return fetch(target, init);
};

export const GET: RequestHandler = async ({ request, params, fetch }) => proxy({ request, params, fetch });
export const POST: RequestHandler = async ({ request, params, fetch }) => proxy({ request, params, fetch });
export const PUT: RequestHandler = async ({ request, params, fetch }) => proxy({ request, params, fetch });
export const PATCH: RequestHandler = async ({ request, params, fetch }) => proxy({ request, params, fetch });
export const DELETE: RequestHandler = async ({ request, params, fetch }) => proxy({ request, params, fetch });
export const OPTIONS: RequestHandler = async ({ request, params, fetch }) => proxy({ request, params, fetch });
