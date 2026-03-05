const normalizeBaseUrl = (value) => value.replace(/\/$/, "");
export const config = {
    authBaseUrl: normalizeBaseUrl(process.env.AUTH_BASE_URL ?? ""),
    giteaBaseUrl: normalizeBaseUrl(process.env.GITEA_BASE_URL ?? ""),
    giteaToken: process.env.GITEA_TOKEN,
    webOrigin: process.env.WEB_ORIGIN,
    tokenCookieName: process.env.TOKEN_COOKIE_NAME ?? "x_token"
};
export const assertRequiredConfig = () => {
    if (!config.giteaBaseUrl) {
        throw new Error("Missing required env: GITEA_BASE_URL");
    }
    if (!config.authBaseUrl) {
        throw new Error("Missing required env: AUTH_BASE_URL");
    }
};
