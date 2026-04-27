import { fileURLToPath, URL } from "node:url";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const protocolDir = fileURLToPath(
	new URL("../../packages/protocol/src", import.meta.url),
);
const sdkDir = fileURLToPath(
	new URL("../../packages/sdk/src", import.meta.url),
);

export default defineConfig({
	resolve: {
		alias: [
			// protocol subpaths — must come before bare package name
			{
				find: /^@neta-art\/cohub-protocol\/core$/,
				replacement: `${protocolDir}/core/index.ts`,
			},
			{
				find: /^@neta-art\/cohub-protocol\/model$/,
				replacement: `${protocolDir}/model/session.ts`,
			},
			{
				find: /^@neta-art\/cohub-protocol\/realtime$/,
				replacement: `${protocolDir}/realtime/index.ts`,
			},
			{
				find: /^@neta-art\/cohub-protocol\/gateway$/,
				replacement: `${protocolDir}/gateway/index.ts`,
			},
			{
				find: /^@neta-art\/cohub-protocol\/task$/,
				replacement: `${protocolDir}/task/index.ts`,
			},
			{
				find: /^@neta-art\/cohub-protocol\/fs$/,
				replacement: `${protocolDir}/fs/index.ts`,
			},
			// protocol bare import
			{
				find: /^@neta-art\/cohub-protocol$/,
				replacement: `${protocolDir}/index.ts`,
			},
			// sdk subpaths
			{
				find: /^@neta-art\/cohub\/http$/,
				replacement: `${sdkDir}/http.ts`,
			},
			{
				find: /^@neta-art\/cohub\/websocket$/,
				replacement: `${sdkDir}/websocket.ts`,
			},
			// sdk bare import
			{
				find: /^@neta-art\/cohub$/,
				replacement: `${sdkDir}/index.ts`,
			},
		],
	},
	dev: {
		sourcemap: {
			js: true,
			css: true,
		},
	},
	plugins: [
		tailwindcss(),
		sveltekit(),
		VitePWA({
			registerType: undefined,
			injectRegister: null,
			includeAssets: ["robots.txt", "pwa/*.png"],
			manifest: {
				name: "Cohub",
				short_name: "Cohub",
				description: "AI-powered space collaboration",
				theme_color: "#FF3E00",
				background_color: "#1a1a1a",
				display: "standalone",
				icons: [
					{
						src: "/pwa/icon-192x192.png",
						sizes: "192x192",
						type: "image/png",
					},
					{
						src: "/pwa/icon-512x512.png",
						sizes: "512x512",
						type: "image/png",
					},
				],
			},
			workbox: {
				globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
				navigateFallback: undefined,
			},
		}),
	],
});
