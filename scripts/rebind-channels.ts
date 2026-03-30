import { bindRuntimeChannelsToGateway } from "../apps/api/src/channels.js";

async function main() {
  const runtimeId = process.argv[2];
  if (!runtimeId) {
    console.error("Usage: npx tsx rebind-channels.ts <runtimeId>");
    process.exit(1);
  }
  console.log(`Rebinding channels for runtime ${runtimeId}...`);
  await bindRuntimeChannelsToGateway(runtimeId);
  console.log("Done!");
}

main().catch(console.error);
