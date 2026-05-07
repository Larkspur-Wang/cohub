import { fileURLToPath, URL } from "node:url";
import adapter from "@sveltejs/adapter-cloudflare";

const protocolDir = fileURLToPath(
	new URL("../../packages/protocol/src", import.meta.url),
);
const sdkDir = fileURLToPath(
	new URL("../../packages/sdk/src", import.meta.url),
);

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		sourcemap: true,
	},
	kit: {
		adapter: adapter(),
		alias: {
			// protocol subpaths — must come before bare package alias to avoid prefix matching
			"@neta-art/cohub-protocol/core": `${protocolDir}/core/index.ts`,
			"@neta-art/cohub-protocol/fs": `${protocolDir}/fs/index.ts`,
			"@neta-art/cohub-protocol/gateway": `${protocolDir}/gateway/index.ts`,
			"@neta-art/cohub-protocol/model": `${protocolDir}/model/session.ts`,
			"@neta-art/cohub-protocol/ports": `${protocolDir}/ports/index.ts`,
			"@neta-art/cohub-protocol/realtime": `${protocolDir}/realtime/index.ts`,
			"@neta-art/cohub-protocol/task": `${protocolDir}/task/index.ts`,
			// sdk subpaths
			"@neta-art/cohub/http": `${sdkDir}/http.ts`,
			"@neta-art/cohub/websocket": `${sdkDir}/websocket.ts`,
			// bare package aliases — must be last
			"@neta-art/cohub": `${sdkDir}/index.ts`,
		},
	},
};

export default config;
