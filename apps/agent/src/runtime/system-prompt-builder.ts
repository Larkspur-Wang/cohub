import { access, readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SpaceModListItem } from "@cohub/core/space-mods";
import {
  getAgentPlatformAgentPath,
  getAgentPlatformSkillsPath,
  getAgentUserAgentsPath,
  getAgentUserConfigPath,
  getAgentUserSkillsPath,
  getAgentWorkspaceAgentsPath,
  getAgentWorkspacePath,
  getAgentWorkspaceSkillsPath,
  SANDBOX_PLATFORM_SKILLS_PATH,
  SANDBOX_USER_CONFIG_PATH,
  SANDBOX_USER_SKILLS_PATH,
  SANDBOX_WORKSPACE_PATH,
  SANDBOX_WORKSPACE_SKILLS_PATH,
} from "./paths.js";

const FALLBACK_SYSTEM_PROMPT = "You are a helpful assistant.";

type LoadedContextFile = {
  sandboxPath: string;
  content: string;
};

type LoadedSkill = {
  name: string;
  description: string;
  filePath: string;
  sandboxFilePath: string;
  baseDir: string;
  sandboxBaseDir: string;
  content: string;
};

export type BuildCohubSystemPromptOptions = {
  cwd: string;
  userId?: string | null;
  selectedTools?: string[];
  toolSnippets?: Record<string, string>;
  promptGuidelines?: string[];
  spaceMods?: SpaceModListItem[];
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    const content = (await readFile(path, "utf-8")).trim();
    return content || undefined;
  } catch {
    return undefined;
  }
}

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

async function loadFirstExisting(paths: string[]): Promise<string | undefined> {
  for (const path of paths) {
    const content = await readTextIfExists(path);
    if (content) return content;
  }
  return undefined;
}

async function loadContextFilesFromRoot(root: string, sandboxRoot: string): Promise<LoadedContextFile[]> {
  const files: LoadedContextFile[] = [];
  const agentsContent = await readTextIfExists(join(root, "AGENTS.md"));
  if (agentsContent) {
    files.push({
      sandboxPath: `${sandboxRoot}/AGENTS.md`,
      content: agentsContent,
    });
  }

  const claudeContent = await readTextIfExists(join(root, "CLAUDE.md"));
  if (claudeContent) {
    files.push({
      sandboxPath: `${sandboxRoot}/CLAUDE.md`,
      content: claudeContent,
    });
  }

  return files;
}

async function loadSkillsFromDir(input: {
  agentDir: string;
  sandboxDir: string;
}): Promise<LoadedSkill[]> {
  if (!(await pathExists(input.agentDir))) return [];

  const results: LoadedSkill[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      let stats: Awaited<ReturnType<typeof stat>>;
      try {
        stats = await stat(full);
      } catch {
        continue;
      }

      if (!stats.isDirectory()) continue;

      const skillFile = join(full, "SKILL.md");
      const content = await readTextIfExists(skillFile);
      if (content) {
        const { attributes } = extractFrontmatter(content);
        const relativePath = skillFile.slice(input.agentDir.length + 1).replaceAll("\\", "/");
        const relativeDir = full.slice(input.agentDir.length + 1).replaceAll("\\", "/");
        results.push({
          name: attributes.name?.trim() || basename(full),
          description: attributes.description?.trim() || "",
          filePath: skillFile,
          sandboxFilePath: `${input.sandboxDir}/${relativePath}`,
          baseDir: full,
          sandboxBaseDir: `${input.sandboxDir}/${relativeDir}`,
          content,
        });
        continue;
      }

      await walk(full);
    }
  };

  await walk(input.agentDir);
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadMergedSkills(cwd: string, userId?: string | null, spaceMods: SpaceModListItem[] = []): Promise<LoadedSkill[]> {
  const modSkillGroups = await Promise.all(spaceMods.map((mod) => loadSkillsFromDir({
    agentDir: join(getAgentWorkspacePath(mod.modSpaceId), ".agents", "skills"),
    sandboxDir: `${mod.mountPath}/.agents/skills`,
  })));

  const [platformSkills, userSkills, workspaceSkills] = await Promise.all([
    loadSkillsFromDir({
      agentDir: getAgentPlatformSkillsPath(),
      sandboxDir: SANDBOX_PLATFORM_SKILLS_PATH,
    }),
    userId
      ? loadSkillsFromDir({
          agentDir: getAgentUserSkillsPath(userId),
          sandboxDir: SANDBOX_USER_SKILLS_PATH,
        })
      : Promise.resolve([]),
    loadSkillsFromDir({
      agentDir: getAgentWorkspaceSkillsPath(cwd),
      sandboxDir: SANDBOX_WORKSPACE_SKILLS_PATH,
    }),
  ]);

  const merged = new Map<string, LoadedSkill>();
  for (const skill of platformSkills) merged.set(skill.name, skill);
  for (const skills of modSkillGroups) {
    for (const skill of skills) merged.set(skill.name, skill);
  }
  for (const skill of userSkills) merged.set(skill.name, skill);
  for (const skill of workspaceSkills) merged.set(skill.name, skill);
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function formatSkillsForPrompt(skills: LoadedSkill[]): string {
  if (skills.length === 0) return "";

  let out = "The following skills provide specialized instructions for specific tasks.\n";
  out += "Use the read tool to load a skill's file when the task matches its description.\n";
  out += "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.\n\n";
  out += "<available_skills>\n";
  for (const skill of skills) {
    out += "  <skill>\n";
    out += `    <name>${skill.name}</name>\n`;
    out += `    <description>${skill.description}</description>\n`;
    out += `    <location>${skill.sandboxFilePath}</location>\n`;
    out += "  </skill>\n";
  }
  out += "</available_skills>";
  return out;
}

export async function buildCohubSystemPrompt(options: BuildCohubSystemPromptOptions): Promise<string> {
  const {
    cwd,
    userId,
    selectedTools = ["read", "bash", "edit", "write"],
    toolSnippets = {},
    promptGuidelines = [],
    spaceMods = [],
  } = options;

  const workspaceAgentDir = getAgentWorkspaceAgentsPath(cwd);
  const userAgentDir = userId ? getAgentUserAgentsPath(userId) : null;
  const systemPrompt = await loadFirstExisting([
    join(workspaceAgentDir, "SYSTEM.md"),
    ...(userAgentDir ? [join(userAgentDir, "SYSTEM.md")] : []),
    join(getAgentPlatformAgentPath(), "SYSTEM.md"),
  ]) ?? FALLBACK_SYSTEM_PROMPT;

  const appendSystemPrompts = (await Promise.all([
    readTextIfExists(join(getAgentPlatformAgentPath(), "APPEND_SYSTEM.md")),
    ...spaceMods.map((mod) => readTextIfExists(join(getAgentWorkspacePath(mod.modSpaceId), ".cohub", "APPEND_SYSTEM.md"))),
    ...(userAgentDir ? [readTextIfExists(join(userAgentDir, "APPEND_SYSTEM.md"))] : []),
    readTextIfExists(join(workspaceAgentDir, "APPEND_SYSTEM.md")),
  ])).filter((value): value is string => Boolean(value));

  const [userContextFiles, modContextGroups, projectContextFiles, skills] = await Promise.all([
    userId ? loadContextFilesFromRoot(getAgentUserConfigPath(userId), SANDBOX_USER_CONFIG_PATH) : Promise.resolve([]),
    Promise.all(spaceMods.map((mod) => loadContextFilesFromRoot(getAgentWorkspacePath(mod.modSpaceId), mod.mountPath))),
    loadContextFilesFromRoot(cwd, SANDBOX_WORKSPACE_PATH),
    selectedTools.includes("read") ? loadMergedSkills(cwd, userId, spaceMods) : Promise.resolve([]),
  ]);

  const sections: string[] = [systemPrompt, ...appendSystemPrompts];

  if (userContextFiles.length > 0) {
    let userContext = "# User Context\n\nThe following are user-specific preferences and instructions. Follow them when they do not conflict with platform, safety, or project-specific instructions:";
    for (const file of userContextFiles) {
      userContext += `\n\n## ${file.sandboxPath}\n\n${file.content}`;
    }
    sections.push(userContext);
  }

  const modContextFiles = modContextGroups.flat();
  if (spaceMods.length > 0 || modContextFiles.length > 0) {
    let modContext = "# Space Mods\n\nMounted read-only spaces available under /mods. Priority: platform < mods < user < workspace.";
    for (const mod of spaceMods) {
      modContext += `\n- ${mod.name ?? mod.modSpaceName ?? mod.modSpaceId}: ${mod.mountPath}`;
    }
    for (const file of modContextFiles) {
      modContext += `\n\n## ${file.sandboxPath}\n\n${file.content}`;
    }
    sections.push(modContext);
  }

  if (projectContextFiles.length > 0) {
    let projectContext = "# Project Context\n\nProject-specific instructions and guidelines:";
    for (const file of projectContextFiles) {
      projectContext += `\n\n## ${file.sandboxPath}\n\n${file.content}`;
    }
    sections.push(projectContext);
  }

  if (skills.length > 0) {
    sections.push(formatSkillsForPrompt(skills));
  }

  const visibleTools = selectedTools.filter((name) => toolSnippets[name]);
  const toolsList = visibleTools.length > 0
    ? visibleTools.map((name) => `- ${name}: ${toolSnippets[name]}`).join("\n")
    : "";

  const guidelines = new Set<string>();
  if (selectedTools.includes("bash") && (selectedTools.includes("grep") || selectedTools.includes("find") || selectedTools.includes("ls"))) {
    guidelines.add("Prefer grep/find/ls tools over bash for file exploration when available");
  }
  for (const item of promptGuidelines) {
    const value = item.trim();
    if (value) guidelines.add(value);
  }

  if (systemPrompt === FALLBACK_SYSTEM_PROMPT) {
    if (toolsList) {
      sections.push(`Available tools:\n${toolsList}`);
    }
    if (guidelines.size > 0) {
      sections.push(`Guidelines:\n${Array.from(guidelines).map((line) => `- ${line}`).join("\n")}`);
    }
  }

  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  sections.push(`Current date: ${date}`);
  sections.push(`Current working directory: ${SANDBOX_WORKSPACE_PATH}`);

  return sections.filter((section) => section.trim().length > 0).join("\n\n");
}
