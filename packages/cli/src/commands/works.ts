import type { Permission, WorkCreateInput, WorkMeta, WorkStatus, WorkTargetType, WorkUpdateInput } from "@neta-art/cohub";
import type { Command } from "commander";
import { createClient } from "../client.js";
import { error, handleHttp, json as outJson, jsonRequested, ok, table } from "../output.js";
import { resolveSpace } from "../space.js";

const WORK_STATUSES = ["draft", "published", "disabled"] as const;

const collectOption = (value: string, previous: string[] = []): string[] => [...previous, value];

function parseChoice<const T extends readonly string[]>(value: string, name: string, choices: T): T[number] {
  if ((choices as readonly string[]).includes(value)) return value as T[number];
  return error(`Invalid ${name}`, `Use one of: ${choices.join(", ")}`);
}

function parseJsonObject(value: string | undefined, name: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // handled below
  }
  return error(`Invalid ${name}`, `${name} must be a JSON object`);
}

function compactObject<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function withCohubBarMeta(input: {
  meta?: WorkMeta | null;
  hideCohubBar?: boolean;
  showCohubBar?: boolean;
}): WorkMeta | null | undefined {
  if (!input.hideCohubBar && !input.showCohubBar) return input.meta;
  const meta = input.meta ? { ...input.meta } : {};
  const presentation = meta.presentation && typeof meta.presentation === "object" && !Array.isArray(meta.presentation)
    ? { ...(meta.presentation as Record<string, unknown>) }
    : {};
  if (input.hideCohubBar) presentation.hideCohubBar = true;
  if (input.showCohubBar) delete presentation.hideCohubBar;
  if (Object.keys(presentation).length > 0) meta.presentation = presentation;
  else delete meta.presentation;
  return Object.keys(meta).length > 0 ? meta : null;
}

function resolveTarget(opts: { file?: string; dir?: string; port?: string }): { targetType: WorkTargetType; targetRef: string } | null {
  const targets = [
    opts.file ? { targetType: "file" as const, targetRef: opts.file } : null,
    opts.dir ? { targetType: "directory" as const, targetRef: opts.dir } : null,
    opts.port ? { targetType: "port" as const, targetRef: opts.port } : null,
  ].filter((target): target is { targetType: WorkTargetType; targetRef: string } => Boolean(target));
  if (targets.length === 0) return null;
  if (targets.length > 1) return error("Conflicting target", "Use only one of --file, --dir, or --port");
  return targets[0] ?? null;
}

function resolveStatus(opts: { draft?: boolean; disabled?: boolean; status?: string }): WorkStatus {
  const values = [opts.status, opts.draft ? "draft" : undefined, opts.disabled ? "disabled" : undefined].filter(Boolean);
  if (values.length > 1) return error("Conflicting status", "Use only one of --status, --draft, or --disabled");
  return values[0] ? parseChoice(values[0], "status", WORK_STATUSES) : "published";
}

function printWork(work: Record<string, unknown>): void {
  table([work], [
    { key: "id", label: "ID" },
    { key: "slug", label: "Slug" },
    { key: "status", label: "Status" },
    { key: "targetType", label: "Target" },
    { key: "targetRef", label: "Ref" },
    { key: "latestVersion", label: "Version" },
    { key: "publishedAt", label: "Published" },
  ]);
}

async function confirmDelete(opts: { yes?: boolean }): Promise<void> {
  if (opts.yes) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return error("Confirmation required", "Pass --yes to delete the work.");
  process.stdout.write("Deleting a work also removes its versions and viewer grants. Continue? [y/N] ");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
    break;
  }
  const answer = Buffer.concat(chunks).toString().trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") return error("Cancelled");
}

type PublishOptions = {
  file?: string;
  dir?: string;
  port?: string;
  draft?: boolean;
  disabled?: boolean;
  status?: string;
  workScope?: string[];
  viewerScope?: string[];
  meta?: string;
  hideCohubBar?: boolean;
  showCohubBar?: boolean;
  json?: boolean;
};

type UpdateOptions = PublishOptions & {
  slug?: string;
  publishVersion?: boolean;
  clearWorkScopes?: boolean;
  clearViewerScopes?: boolean;
};

type ResolveOptions = {
  owner?: string;
  spaceSlug?: string;
  json?: boolean;
};

export function registerWorks(program: Command): void {
  const worksCmd = program.command("works").description("Work management");

  worksCmd
    .command("ls")
    .alias("list")
    .description("List works in the target space")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const spaceId = resolveSpace(worksCmd);
      const client = createClient();
      try {
        const result = await client.works.listBySpace(spaceId);
        if (jsonRequested(opts)) return outJson(result);
        table(result.works, [
          { key: "id", label: "ID" },
          { key: "slug", label: "Slug" },
          { key: "status", label: "Status" },
          { key: "targetType", label: "Target" },
          { key: "targetRef", label: "Ref" },
          { key: "latestVersion", label: "Version" },
          { key: "publishedAt", label: "Published" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  worksCmd
    .command("get <id>")
    .description("Show work details")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const client = createClient();
      try {
        const result = await client.works.get(id);
        if (jsonRequested(opts)) return outJson(result);
        printWork(result.work);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  worksCmd
    .command("resolve <workSlug>")
    .description("Resolve a published work by owner and space slug")
    .option("--owner <username>", "Owner username")
    .option("--space-slug <slug>", "Space slug")
    .option("--json", "Output as JSON")
    .action(async (workSlug: string, opts: ResolveOptions) => {
      if (!opts.owner?.trim()) return error("Missing owner username", "Pass --owner <username>.");
      if (!opts.spaceSlug?.trim()) return error("Missing space slug", "Pass --space-slug <slug>.");
      const client = createClient();
      try {
        const result = await client.works.getBySlug(opts.owner.trim(), opts.spaceSlug.trim(), workSlug);
        if (jsonRequested(opts)) return outJson(result);
        printWork(result.work);
        if (result.content?.url) console.log(`\nURL: ${result.content.url}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  worksCmd
    .command("publish <slug>")
    .description("Create or publish a work in the target space")
    .option("--file <path>", "Publish a HTML file")
    .option("--dir <path>", "Publish a directory site")
    .option("--port <port>", "Publish a public sandbox port")
    .option("--draft", "Create as draft")
    .option("--disabled", "Create as disabled")
    .option("--status <status>", "Work status: draft, published, disabled")
    .option("--work-scope <scope>", "Scope granted to the work runtime (space.view, session.view, file.view, taskrun.view)", collectOption, [])
    .option("--viewer-scope <scope>", "Scope viewers may request (session.prompt.readonly, session.prompt.fullaccess, generation.create, user.space.list, user.session.list, user.usage.read)", collectOption, [])
    .option("--meta <json>", "Work metadata as a JSON object")
    .option("--hide-cohub-bar", "Hide the Cohub footer bar on the public work page")
    .option("--show-cohub-bar", "Show the Cohub footer bar on the public work page")
    .option("--json", "Output as JSON")
    .action(async (slug: string, opts: PublishOptions) => {
      if (opts.hideCohubBar && opts.showCohubBar) return error("Conflicting Cohub bar options", "Use either --hide-cohub-bar or --show-cohub-bar.");
      const target = resolveTarget(opts);
      if (!target) return error("Missing target", "Use one of --file, --dir, or --port.");
      const spaceId = resolveSpace(worksCmd);
      const client = createClient();
      const status = resolveStatus(opts);
      const meta = withCohubBarMeta({
        meta: parseJsonObject(opts.meta, "meta"),
        hideCohubBar: opts.hideCohubBar,
        showCohubBar: opts.showCohubBar,
      });
      const input: WorkCreateInput = {
        spaceId,
        slug,
        status,
        targetType: target.targetType,
        targetRef: target.targetRef,
        workScopes: opts.workScope as Permission[],
        allowedViewerScopes: opts.viewerScope as Permission[],
        meta,
      };
      try {
        const result = await client.works.create(input);
        if (jsonRequested(opts)) return outJson(result);
        ok(`Work published: ${result.work.id}`);
        printWork(result.work);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  worksCmd
    .command("update <id>")
    .description("Update work settings or publish a new version")
    .option("--slug <slug>", "New work slug")
    .option("--file <path>", "Use a HTML file target")
    .option("--dir <path>", "Use a directory site target")
    .option("--port <port>", "Use a public sandbox port target")
    .option("--draft", "Set status to draft")
    .option("--disabled", "Set status to disabled")
    .option("--status <status>", "Work status: draft, published, disabled")
    .option("--publish-version", "Force publishing a new version")
    .option("--work-scope <scope>", "Scope granted to the work runtime (space.view, session.view, file.view, taskrun.view)", collectOption, [])
    .option("--viewer-scope <scope>", "Scope viewers may request (session.prompt.readonly, session.prompt.fullaccess, generation.create, user.space.list, user.session.list, user.usage.read)", collectOption, [])
    .option("--clear-work-scopes", "Clear work runtime scopes")
    .option("--clear-viewer-scopes", "Clear viewer-requestable scopes")
    .option("--meta <json>", "Work metadata as a JSON object")
    .option("--hide-cohub-bar", "Hide the Cohub footer bar on the public work page")
    .option("--show-cohub-bar", "Show the Cohub footer bar on the public work page")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: UpdateOptions) => {
      if (opts.hideCohubBar && opts.showCohubBar) return error("Conflicting Cohub bar options", "Use either --hide-cohub-bar or --show-cohub-bar.");
      const target = resolveTarget(opts);
      if (opts.clearWorkScopes && opts.workScope?.length) return error("Conflicting work scopes", "Use either --work-scope or --clear-work-scopes.");
      if (opts.clearViewerScopes && opts.viewerScope?.length) return error("Conflicting viewer scopes", "Use either --viewer-scope or --clear-viewer-scopes.");
      const hasMetaUpdate = opts.meta !== undefined || opts.hideCohubBar || opts.showCohubBar;
      const client = createClient();
      let meta: WorkMeta | null | undefined;
      if (hasMetaUpdate) {
        let baseMeta = opts.meta !== undefined ? parseJsonObject(opts.meta, "meta") ?? null : undefined;
        if (baseMeta === undefined && (opts.hideCohubBar || opts.showCohubBar)) {
          try {
            baseMeta = (await client.works.get(id)).work.meta;
          } catch (e: unknown) {
            handleHttp(e);
          }
        }
        meta = withCohubBarMeta({
          meta: baseMeta,
          hideCohubBar: opts.hideCohubBar,
          showCohubBar: opts.showCohubBar,
        });
      }
      const input = compactObject<WorkUpdateInput>({
        slug: opts.slug,
        status: opts.status || opts.draft || opts.disabled ? resolveStatus(opts) : undefined,
        targetType: target?.targetType,
        targetRef: target?.targetRef,
        publishVersion: opts.publishVersion || undefined,
        workScopes: opts.clearWorkScopes ? [] : opts.workScope?.length ? opts.workScope as Permission[] : undefined,
        allowedViewerScopes: opts.clearViewerScopes ? [] : opts.viewerScope?.length ? opts.viewerScope as Permission[] : undefined,
        meta,
      });
      if (Object.keys(input).length === 0) return error("Nothing to update", "Pass --slug, --file, --dir, --port, --status, --publish-version, --work-scope, --viewer-scope, --clear-work-scopes, --clear-viewer-scopes, --meta, --hide-cohub-bar, or --show-cohub-bar.");
      try {
        const result = await client.works.update(id, input);
        if (jsonRequested(opts)) return outJson(result);
        ok("Work updated");
        printWork(result.work);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  worksCmd
    .command("versions <id>")
    .description("List work versions")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const client = createClient();
      try {
        const result = await client.works.listVersions(id);
        if (jsonRequested(opts)) return outJson(result);
        table(result.versions, [
          { key: "version", label: "Version" },
          { key: "id", label: "ID" },
          { key: "status", label: "Status" },
          { key: "targetType", label: "Target" },
          { key: "targetRef", label: "Ref" },
          { key: "publishedAt", label: "Published" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  worksCmd
    .command("rm <id>")
    .alias("delete")
    .description("Delete a work")
    .option("-y, --yes", "Confirm deletion")
    .action(async (id: string, opts: { yes?: boolean }) => {
      await confirmDelete(opts);
      const client = createClient();
      try {
        await client.works.delete(id);
        ok("Work deleted");
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}
