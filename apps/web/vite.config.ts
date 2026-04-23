import { fileURLToPath, URL } from "node:url";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	resolve: {
		alias: {
			"@neta-art/cohub-protocol": fileURLToPath(
				new URL("../../packages/protocol/src/index.ts", import.meta.url),
			),
			"@neta-art/cohub-protocol/core": fileURLToPath(
				new URL("../../packages/protocol/src/core/index.ts", import.meta.url),
			),
			"@neta-art/cohub-protocol/model": fileURLToPath(
				new URL(
					"../../packages/protocol/src/model/session.ts",
					import.meta.url,
				),
			),
			"@neta-art/cohub-protocol/realtime": fileURLToPath(
				new URL(
					"../../packages/protocol/src/realtime/index.ts",
					import.meta.url,
				),
			),
			"@neta-art/cohub-protocol/gateway": fileURLToPath(
				new URL(
					"../../packages/protocol/src/gateway/index.ts",
					import.meta.url,
				),
			),
			"@neta-art/cohub-protocol/task": fileURLToPath(
				new URL("../../packages/protocol/src/task/index.ts", import.meta.url),
			),
			"@neta-art/cohub-protocol/fs": fileURLToPath(
				new URL("../../packages/protocol/src/fs/index.ts", import.meta.url),
			),
			"@cohub/sdk": fileURLToPath(
				new URL("../../packages/sdk/src/index.ts", import.meta.url),
			),
			"@cohub/sdk/http": fileURLToPath(
				new URL("../../packages/sdk/src/http.ts", import.meta.url),
			),
			"@cohub/sdk/websocket": fileURLToPath(
				new URL("../../packages/sdk/src/websocket.ts", import.meta.url),
			),
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
