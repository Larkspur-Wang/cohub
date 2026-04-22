import { config } from "./config.js";

export const createRepository = async (
  token: string,
  name: string,
  isPrivate = false,
) => {
  const response = await fetch(`${config.giteaBaseUrl}/api/v1/user/repos`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      private: isPrivate,
      auto_init: false,
    }),
  });

  if (response.status === 409) return { name, alreadyExists: true };
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Gitea create repo error: ${response.status} ${text}`);
  }

  return response.json();
};

export type GiteaForkResponse = {
  id: number;
  name: string;
  owner: {
    id: number;
    username: string;
    login: string;
  };
  full_name: string;
  html_url: string;
  ssh_url: string;
  clone_url: string;
  parent?: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      username: string;
      login: string;
    };
  };
};

export const forkRepository = async (
  sourceOwner: string,
  sourceRepo: string,
  targetUserToken: string,
): Promise<GiteaForkResponse | { alreadyExists: true }> => {
  const response = await fetch(
    `${config.giteaBaseUrl}/api/v1/repos/${encodeURIComponent(sourceOwner)}/${encodeURIComponent(sourceRepo)}/forks`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${targetUserToken}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (response.status === 409) return { alreadyExists: true };
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Gitea fork repo error: ${response.status} ${text}`);
  }

  return (await response.json()) as GiteaForkResponse;
};

export const renameRepository = async (
  owner: string,
  currentName: string,
  newName: string,
  token: string,
) => {
  const response = await fetch(
    `${config.giteaBaseUrl}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(currentName)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: newName,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Gitea rename repo error: ${response.status} ${text}`);
  }

  return response.json();
};
