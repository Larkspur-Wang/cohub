import { CohubModelRegistry } from "../src/runtime/model-registry.js";
import { loadPlatformPromptResources, SANDBOX_PLATFORM_SKILLS_ROOT, SANDBOX_WORKSPACE_ROOT } from "../src/runtime/resources.js";
import { buildCohubSystemPrompt } from "../src/runtime/system-prompt.js";

async function main() {
  const models = new CohubModelRegistry();
  const resources = loadPlatformPromptResources();

  console.log("[smoke] model registry error:", models.getError() ?? null);
  console.log("[smoke] available models:", models.getAvailable().map((m) => `${m.provider}/${m.id}`));
  console.log("[smoke] skill count:", resources.skills.length);
  console.log("[smoke] skill locations:", resources.skills.map((s) => s.sandboxFilePath));
  console.log("[smoke] cwd:", SANDBOX_WORKSPACE_ROOT);
  console.log("[smoke] skills root:", SANDBOX_PLATFORM_SKILLS_ROOT);

  const prompt = buildCohubSystemPrompt({
    customPrompt: resources.systemPrompt,
    appendSystemPrompt: resources.appendSystemPrompt,
    selectedTools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
    toolSnippets: {
      read: "Read file contents",
      bash: "Execute bash commands",
      edit: "Make precise file edits with exact text replacement",
      write: "Create or overwrite files",
      grep: "Search file contents",
      find: "Search files by glob pattern",
      ls: "List directory contents",
    },
    skills: resources.skills,
  });

  console.log("[smoke] prompt preview:\n");
  console.log(prompt.slice(0, 4000));
}

main().catch((error) => {
  console.error("[smoke] failed:", error);
  process.exit(1);
});
