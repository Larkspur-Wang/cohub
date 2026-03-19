import { SANDBOX_POD_TEMPLATE } from "./templates/sandbox-pod.js";

type TemplateVars = Record<string, string | undefined>;

const replaceInValue = (value: unknown, vars: TemplateVars): unknown => {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key: string) => vars[key] ?? "");
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceInValue(item, vars));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, replaceInValue(nestedValue, vars)]),
    );
  }

  return value;
};

export const renderSandboxPodTemplate = (vars: TemplateVars) => {
  return replaceInValue(SANDBOX_POD_TEMPLATE, vars);
};
