import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Hono } from "hono";
import { useUserPrincipal, type AuthUser, type RequestPrincipal } from "./middleware.js";

const account = { uuid: "user-1" } as AuthUser;

async function requestWith(principal: RequestPrincipal | null) {
  const app = new Hono<{ Variables: { principal: RequestPrincipal | null } }>();
  app.use(async (c, next) => {
    c.set("principal", principal);
    await next();
  });
  app.get("/", (c) => {
    const user = useUserPrincipal(c);
    return user instanceof Response ? user : c.json({ uuid: user.uuid });
  });
  return app.request("/");
}

describe("useUserPrincipal", () => {
  it("accepts only a real account principal", async () => {
    const response = await requestWith({ type: "user", user: account });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { uuid: "user-1" });
  });

  it("rejects delegated principals", async () => {
    const principals: RequestPrincipal[] = [
      { type: "app_session", appSession: { userUuid: "user-1" } as never },
      { type: "preview_session", previewSession: { userUuid: "user-1" } as never },
      { type: "execution", execution: { actorUserId: "user-1" } as never },
    ];
    for (const principal of principals) {
      const response = await requestWith(principal);
      assert.equal(response.status, 403);
    }
  });

  it("keeps anonymous requests unauthorized", async () => {
    const response = await requestWith(null);
    assert.equal(response.status, 401);
  });
});
