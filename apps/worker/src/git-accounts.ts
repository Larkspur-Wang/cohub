import { and, eq } from "drizzle-orm";
import { db } from "./db.js";
import { userGitAccounts } from "./db-schema.js";
import { decryptSecret } from "./crypto.js";

export async function getUserGitAccount(userUuid: string) {
  // Internal worker-only helper. Callers must already have established ownership
  // of the target space / task before resolving another user's managed git account.
  const [existing] = await db
    .select()
    .from(userGitAccounts)
    .where(
      and(
        eq(userGitAccounts.userUuid, userUuid),
        eq(userGitAccounts.provider, "gitea"),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new Error("git account not found");
  }

  return {
    ...existing,
    giteaAccessToken: decryptSecret(existing.giteaAccessTokenEncrypted),
    giteaPassword: decryptSecret(existing.giteaPasswordEncrypted),
  };
}
