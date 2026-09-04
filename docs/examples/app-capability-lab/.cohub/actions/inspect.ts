import { createCohubClient, resolveExecutionAppId } from "@neta-art/cohub";

async function readInput(): Promise<unknown> {
  let body = "";
  for await (const chunk of process.stdin) body += chunk;
  return body.trim() ? JSON.parse(body) : null;
}

const client = createCohubClient();
const input = await readInput();
const commerce = await client.app.commerce.getEntitlements()
  .then(({ entitlements, credits }) => ({
    available: true,
    featureCount: entitlements.filter((item) => item.enabled).length,
    creditsAvailable: credits.available,
  }))
  .catch((error: unknown) => ({
    available: false,
    message: error instanceof Error ? error.message : String(error),
  }));

process.stdout.write(JSON.stringify({
  ok: true,
  action: "inspect",
  appId: resolveExecutionAppId(),
  spaceId: process.env.COHUB_SPACE_ID ?? null,
  input,
  commerce,
}));
