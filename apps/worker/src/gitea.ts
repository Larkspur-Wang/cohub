import { config } from "./config.js";

const authHeaders = () => {
  if (!config.giteaToken) throw new Error("GITEA_TOKEN is not configured");
  return { Authorization: `token ${config.giteaToken}` };
};

export const createInternalRepository = async (name: string, isPrivate = true) => {
  const response = await fetch(`${config.giteaBaseUrl}/api/v1/orgs/${encodeURIComponent(config.giteaOrg)}/repos`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, private: isPrivate, auto_init: false }),
  });

  if (response.status === 409) return { name, alreadyExists: true };
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Gitea create internal repo error: ${response.status} ${text}`);
  }

  return response.json();
};

export const buildInternalRepoRemoteUrl = (repoName: string) => {
  if (!config.giteaToken) throw new Error("GITEA_TOKEN is not configured");
  const base = new URL(config.giteaBaseUrl);
  base.username = "x-access-token";
  base.password = config.giteaToken;
  base.pathname = `/${config.giteaOrg}/${repoName}.git`;
  return base.toString();
};
