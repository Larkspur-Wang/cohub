import { getFile, getTree, getWorkspace } from "$lib/api";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, fetch }) => {
  const { owner, repo } = params;

  const [workspace, treeData, readmeData] = await Promise.all([
    getWorkspace(owner, repo, fetch).catch(() => null),
    getTree(owner, repo, "", undefined, fetch).catch(() => null),
    getFile(owner, repo, "README.md", undefined, fetch).catch(() => null)
  ]);

  return {
    owner,
    repo,
    workspace: workspace as {
      full_name?: string;
      default_branch?: string;
    } | null,
    initialTreeEntries: (treeData as { entries?: unknown[] } | null)?.entries ?? [],
    readmeContent: readmeData as { content: string } | null
  };
};