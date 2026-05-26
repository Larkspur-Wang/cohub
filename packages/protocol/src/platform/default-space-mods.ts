export type CohubRuntimeEnv = "dev" | "prod";

export type DefaultSpaceModDefinition = {
  modSpaceId: string;
  name: string | null;
  mountSlug: string | null;
  enabled: boolean;
};

const DEFAULT_SPACE_MODS_BY_ENV = {
  dev: [
    {
      modSpaceId: "d5166a91-7a70-4541-86cf-95c439fd667f",
      name: "Cohub Base",
      mountSlug: "cohub_base",
      enabled: true,
    },
  ],
  prod: [
    {
      modSpaceId: "e81010a7-ff7e-47b7-9f9a-ac4dca458e9c",
      name: "Cohub Base",
      mountSlug: "cohub_base",
      enabled: true,
    },
  ],
} satisfies Record<CohubRuntimeEnv, DefaultSpaceModDefinition[]>;

export function normalizeCohubRuntimeEnv(value: unknown): CohubRuntimeEnv {
  return value === "prod" ? "prod" : "dev";
}

export function getDefaultSpaceModsForEnv(env: CohubRuntimeEnv): DefaultSpaceModDefinition[] {
  return DEFAULT_SPACE_MODS_BY_ENV[env].map((mod) => ({ ...mod }));
}
