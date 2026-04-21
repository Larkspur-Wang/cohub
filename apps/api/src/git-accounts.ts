import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { db } from "./db/index.js";
import { userGitAccounts, } from "./db/schema-v2.js";
import {
  createGiteaAccessTokenWithBasicAuth,
  createManagedGiteaUser,
} from "./gitea.js";

const buildManagedUsername = (userUuid: string) => {
  const prefix = config.env === "prod" ? "u_" : "dev_u_";
  return `${prefix}${userUuid}`;
};

const buildManagedEmail = (username: string) =>
  `${username}@${config.giteaManagedEmailDomain}`;

const buildManagedPassword = () => randomBytes(24).toString("hex");

const buildManagedTokenName = () =>
  `cohub-managed-${config.env}-${Date.now()}`;

export async function ensureUserGitAccount(userUuid: string) {
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

  if (existing) {
    return {
      ...existing,
      giteaAccessToken: decryptSecret(existing.giteaAccessTokenEncrypted),
      giteaPassword: decryptSecret(existing.giteaPasswordEncrypted),
    };
  }

  const username = buildManagedUsername(userUuid);
  const password = buildManagedPassword();

  const giteaUser = await createManagedGiteaUser({
    username,
    email: buildManagedEmail(username),
    password,
    mustChangePassword: false,
    sendNotify: false,
    visibility: "limited",
  }).catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("422") || message.includes("already exists") || message.includes("has already been taken")) {
      throw new Error(
        `Managed git account username conflict for ${username}. Database record is missing or inconsistent. Please repair manually.`,
      );
    }
    throw error;
  });

  const token = await createGiteaAccessTokenWithBasicAuth(
    username,
    password,
    buildManagedTokenName(),
  );

  const [created] = await db
    .insert(userGitAccounts)
    .values({
      userUuid,
      provider: "gitea",
      giteaUserId: giteaUser.id,
      giteaUsername: giteaUser.login,
      giteaPasswordEncrypted: encryptSecret(password),
      giteaAccessTokenEncrypted: encryptSecret(token.sha1),
      status: "active",
      lastVerifiedAt: new Date(),
      meta: {
        source: "managed",
        env: config.env,
        giteaUserVisibility: "limited",
      },
    })
    .returning();

  return {
    ...created,
    giteaAccessToken: token.sha1,
    giteaPassword: password,
  };
}
