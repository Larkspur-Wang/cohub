export function resolveDeclarationApiKey(value: string, env: Record<string, string | undefined> = process.env): string {
  const envPrefix = "$env:";
  if (!value.startsWith(envPrefix)) return value;
  const envName = value.slice(envPrefix.length).trim();
  if (!envName) throw new Error("Generation adapter api_key env name is empty");
  const envValue = env[envName];
  if (!envValue) throw new Error(`Missing generation adapter API key environment variable: ${envName}`);
  return envValue;
}
