import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { PLATFORM_AGENT_DIR, PLATFORM_SKILLS_DIR } from "../env.js";

export const SANDBOX_WORKSPACE_ROOT = "/workspace";
export const SANDBOX_PLATFORM_ROOT = "/configs/platform";
export const SANDBOX_PLATFORM_SKILLS_ROOT = "/configs/platform/.agents/skills";

export type LoadedSkill = {
  name: string;
  description: string;
  filePath: string;
  sandboxFilePath: string;
  baseDir: string;
  sandboxBaseDir: string;
  content: string;
};

function extractFrontmatter(markdown: string): { attributes: Record<string, string>; body: string } {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { attributes: {}, body: markdown };
  const raw = match[1] ?? "";
  const attributes: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) attributes[key] = value;
  }
  return { attributes, body: markdown.slice(match[0].length) };
}

function mapSkillPathToSandbox(agentPath: string): string {
  if (agentPath === PLATFORM_SKILLS_DIR) return SANDBOX_PLATFORM_SKILLS_ROOT;
  if (agentPath.startsWith(`${PLATFORM_SKILLS_DIR}/`)) {
    return `${SANDBOX_PLATFORM_SKILLS_ROOT}/${agentPath.slice(PLATFORM_SKILLS_DIR.length + 1)}`;
  }
  return agentPath;
}

export function loadPlatformSkills(): LoadedSkill[] {
  if (!existsSync(PLATFORM_SKILLS_DIR)) return [];

  const results: LoadedSkill[] = [];
  const walk = (dir: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      let stats: ReturnType<typeof statSync>;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        const skillFile = join(full, "SKILL.md");
        if (existsSync(skillFile)) {
          try {
            const content = readFileSync(skillFile, "utf-8");
            const { attributes } = extractFrontmatter(content);
            const skillName = attributes.name?.trim() || basename(full);
            const description = attributes.description?.trim() || "";
            results.push({
              name: skillName,
              description,
              filePath: skillFile,
              sandboxFilePath: mapSkillPathToSandbox(skillFile),
              baseDir: full,
              sandboxBaseDir: mapSkillPathToSandbox(full),
              content,
            });
          } catch {
            // ignore unreadable skills for now
          }
          continue;
        }
        walk(full);
      }
    }
  };

  walk(PLATFORM_SKILLS_DIR);
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export type PlatformPromptResources = {
  systemPrompt?: string;
  appendSystemPrompt?: string;
  skills: LoadedSkill[];
};

export function loadPlatformPromptResources(): PlatformPromptResources {
  const systemPath = join(PLATFORM_AGENT_DIR, "SYSTEM.md");
  const appendPath = join(PLATFORM_AGENT_DIR, "APPEND_SYSTEM.md");
  const systemPrompt = existsSync(systemPath) ? readFileSync(systemPath, "utf-8") : undefined;
  const appendSystemPrompt = existsSync(appendPath) ? readFileSync(appendPath, "utf-8") : undefined;
  return {
    systemPrompt,
    appendSystemPrompt,
    skills: loadPlatformSkills(),
  };
}
