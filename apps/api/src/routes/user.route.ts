import { Hono } from "hono";
import { db } from "../db/index.js";
import { userGitAccounts } from "@cohub/db-schema";
import { eq, and } from "drizzle-orm";
import { useAuth } from "../lib/middleware.js";
import { ensureUserGitAccount } from "../git-accounts.js";
import { addSshKey, deleteSshKey, listSshKeys } from "../gitea.js";

const router = new Hono();

router.get("/", async (c) => {
  const user = useAuth(c);

  const gitAccount = await ensureUserGitAccount(user.uuid);
  const keys = await listSshKeys(gitAccount.giteaAccessToken);
  const normalizedKeys = keys.map((key) => ({
    id: String(key.id),
    key: key.key,
    title: key.title,
    giteaKeyId: key.id,
    createdAt: new Date().toISOString(),
  }));

  await db
    .update(userGitAccounts)
    .set({
      sshPublicKeys: normalizedKeys,
      updatedAt: new Date(),
      lastVerifiedAt: new Date(),
    })
    .where(and(eq(userGitAccounts.userUuid, user.uuid), eq(userGitAccounts.provider, "gitea")));

  return c.json(normalizedKeys);
});

router.post("/", async (c) => {
  const user = useAuth(c);

  const body = (await c.req.json<{ key?: string; title?: string }>().catch(() => ({}))) as {
    key?: string;
    title?: string;
  };
  const key = body.key?.trim();
  const title = body.title?.trim();
  if (!key || !title) return c.json({ message: "key and title are required" }, 400);

  const gitAccount = await ensureUserGitAccount(user.uuid);
  const created = await addSshKey(gitAccount.giteaAccessToken, key, title);
  if ("alreadyExists" in created) return c.json({ message: "SSH key already exists" }, 409);

  const record = {
    id: String(created.id),
    key: created.key,
    title: created.title,
    giteaKeyId: created.id,
    createdAt: new Date().toISOString(),
  };

  const existingKeys = (gitAccount.sshPublicKeys ?? []).filter((item) => item.giteaKeyId !== created.id);
  const nextKeys = [record, ...existingKeys];
  await db
    .update(userGitAccounts)
    .set({
      sshPublicKeys: nextKeys,
      updatedAt: new Date(),
      lastVerifiedAt: new Date(),
    })
    .where(and(eq(userGitAccounts.userUuid, user.uuid), eq(userGitAccounts.provider, "gitea")));

  return c.json(record, 201);
});

router.delete("/:id", async (c) => {
  const user = useAuth(c);
  const keyId = Number(c.req.param("id"));
  if (!Number.isFinite(keyId)) return c.json({ message: "invalid key id" }, 400);

  const gitAccount = await ensureUserGitAccount(user.uuid);
  await deleteSshKey(gitAccount.giteaAccessToken, keyId);
  const nextKeys = (gitAccount.sshPublicKeys ?? []).filter((item) => item.giteaKeyId !== keyId);
  await db
    .update(userGitAccounts)
    .set({
      sshPublicKeys: nextKeys,
      updatedAt: new Date(),
      lastVerifiedAt: new Date(),
    })
    .where(and(eq(userGitAccounts.userUuid, user.uuid), eq(userGitAccounts.provider, "gitea")));

  return c.json({ ok: true });
});

export default router;
