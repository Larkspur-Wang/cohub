import { clearAuthToken, getMe, setAuthToken } from "$lib/api";

export type HubUser = {
  id?: number;
  uuid?: string;
  nick_name?: string;
  phone_num?: string;
  avatar_url?: string;
  [key: string]: unknown;
};

export const fetchCurrentUser = async () => {
  try {
    const user = await getMe();
    return user as HubUser;
  } catch {
    return null;
  }
};

export const loginWithToken = async (token: string) => {
  const result = (await setAuthToken(token)) as { user: HubUser };
  return result.user;
};

export const logout = async () => {
  await clearAuthToken();
};
