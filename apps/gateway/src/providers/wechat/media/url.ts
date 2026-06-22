import dns from "node:dns/promises";
import net from "node:net";

const MAX_REDIRECTS = 3;

function isPrivateIpv4(ip: string) {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const first = parts[0] ?? 0;
  const second = parts[1] ?? 0;
  return first === 10 || first === 127 || first === 0 || first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168;
}

function isPrivateIpv6(ip: string) {
  const normalized = ip.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

function isPrivateIp(ip: string) {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true;
}

function isAllowedHost(hostname: string, allowedHosts?: string[]) {
  if (!allowedHosts?.length) return true;
  return allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

async function assertPublicHost(url: URL, allowedHosts?: string[]) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`unsupported URL protocol: ${url.protocol}`);
  if (!isAllowedHost(url.hostname, allowedHosts)) throw new Error(`URL host is not allowed: ${url.hostname}`);

  const literalFamily = net.isIP(url.hostname);
  if (literalFamily !== 0) {
    if (isPrivateIp(url.hostname)) throw new Error("URL resolves to a private address");
    return;
  }

  const records = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (records.length === 0 || records.some((record) => isPrivateIp(record.address))) {
    throw new Error("URL resolves to a private address");
  }
}

export async function safeFetch(params: {
  url: string;
  label: string;
  allowedHosts?: string[];
  init?: RequestInit;
}) {
  let current = new URL(params.url);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicHost(current, params.allowedHosts);
    const response = await fetch(current, { ...params.init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    current = new URL(location, current);
  }
  throw new Error(`${params.label}: too many redirects`);
}

export function allowedHostFromBaseUrl(value: string) {
  return new URL(value).hostname;
}
