import { config } from "./config.js";

export const createRepository = async (
  token: string,
  name: string,
  isPrivate = true,
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
