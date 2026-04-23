import type { LoadedSkill } from "./resources.js";
import { SANDBOX_PLATFORM_SKILLS_ROOT, SANDBOX_WORKSPACE_ROOT } from "./resources.js";

export type BuildCohubSystemPromptOptions = {
  customPrompt?: string;
  appendSystemPrompt?: string;
  selectedTools?: string[];
  toolSnippets?: Record<string, string>;
  promptGuidelines?: string[];
  skills?: LoadedSkill[];
};

function formatSkillsForPrompt(skills: LoadedSkill[]): string {
  if (skills.length === 0) return "";
  let out = "\n\nThe following skills provide specialized instructions for specific tasks.\n";
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

export function buildCohubSystemPrompt(options: BuildCohubSystemPromptOptions): string {
  const {
    customPrompt,
    appendSystemPrompt,
    selectedTools = ["read", "bash", "edit", "write"],
    toolSnippets = {},
    promptGuidelines = [],
    skills = [],
  } = options;

  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const visibleTools = selectedTools.filter((name) => toolSnippets[name]);
  const toolsList = visibleTools.length > 0
    ? visibleTools.map((name) => `- ${name}: ${toolSnippets[name]}`).join("\n")
    : "(none)";

  const guidelines = new Set<string>();
  if (selectedTools.includes("bash") && (selectedTools.includes("grep") || selectedTools.includes("find") || selectedTools.includes("ls"))) {
    guidelines.add("Prefer grep/find/ls tools over bash for file exploration when available");
  }
  for (const item of promptGuidelines) {
    const value = item.trim();
    if (value) guidelines.add(value);
  }
  guidelines.add("Be concise and direct in your responses");
  guidelines.add("Show file paths clearly when working with files");
  guidelines.add("Always verify file contents before making edits");
  guidelines.add("Use edit tool for precise changes, write tool for new files");
  guidelines.add("When displaying multimedia files, reply with the relevant URLs directly");

  let prompt = customPrompt?.trim() || `You are an expert assistant operating inside Cohub, helping users accomplish their tasks efficiently.\n\nAvailable tools:\n${toolsList}\n\nIn addition to the tools above, you may have access to other custom tools depending on the project.\n\nGuidelines:\n${Array.from(guidelines).map((line) => `- ${line}`).join("\n")}`;

  if (appendSystemPrompt?.trim()) {
    prompt += `\n\n${appendSystemPrompt.trim()}`;
  }

  if (skills.length > 0 && selectedTools.includes("read")) {
    prompt += formatSkillsForPrompt(skills);
  }

  prompt += `\nCurrent date: ${date}`;
  prompt += `\nCurrent working directory: ${SANDBOX_WORKSPACE_ROOT}`;
  prompt += `\nPlatform skills root: ${SANDBOX_PLATFORM_SKILLS_ROOT}`;
  return prompt;
}
