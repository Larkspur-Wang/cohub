import { fileURLToPath, URL } from "node:url";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	resolve: {
		alias: {
			"@cohub/protocol": fileURLToPath(
				new URL("../../packages/protocol/src/index.ts", import.meta.url),
			),
			"@cohub/sdk": fileURLToPath(
				new URL("../../packages/sdk/src/index.ts", import.meta.url),
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
