import adapter from "@sveltejs/adapter-cloudflare";

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		sourcemap: true,
	},
	kit: {
		adapter: adapter(),
	},
};

export default config;
