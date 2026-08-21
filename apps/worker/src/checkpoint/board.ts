import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import {
  boardCheckpoints,
  boardClips,
  boardConnections,
  boardEffects,
  boardNodes,
  boardCompositions,
  boardTracks,
  boards,
} from "@cohub/db";
import {
  BOARD_PROTOCOL_VERSION,
  BOARD_SNAPSHOT_KIND,
  boardAuthoringItemToNode,
  isBoardPath,
  parseBoardManifest,
  serializeBoardManifest,
} from "@cohub/protocol";
import { db } from "../db.js";
import { captureBoardSnapshots } from "./board-snapshot.js";
import { restoreBoardConnectionRows } from "./board-connections.js";

async function listBoardFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await listBoardFiles(root, path));
    else if (entry.isFile() && isBoardPath(entry.name)) paths.push(path);
  }
  return paths;
}

export async function saveBoardCheckpointSnapshots(input: { checkpointId: string; spaceId: string }) {
  const snapshots = await captureBoardSnapshots({ spaceId: input.spaceId });
  if (snapshots.length > 0) {
    await db.insert(boardCheckpoints).values(snapshots.map((snapshot) => ({
      checkpointId: input.checkpointId,
      sourceBoardId: snapshot.board.id,
      sourceSpaceId: input.spaceId,
      sourceVersion: snapshot.board.version,
      snapshot: snapshot as unknown as Record<string, unknown>,
    })));
  }
  return { count: snapshots.length };
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

export async function restoreBoardCheckpointSnapshots(input: {
  checkpointId: string;
  targetSpaceId: string;
  workspaceDir: string;
}) {
  const snapshots = await db.select().from(boardCheckpoints).where(eq(boardCheckpoints.checkpointId, input.checkpointId));
  const snapshotBySourceId = new Map(snapshots.map((snapshot) => [snapshot.sourceBoardId, snapshot]));
  const files = await listBoardFiles(resolve(input.workspaceDir));
  const restored: Array<{ path: string; boardId: string }> = [];

  for (const absolutePath of files) {
    let manifest: ReturnType<typeof parseBoardManifest>;
    try {
      manifest = parseBoardManifest(await readFile(absolutePath, "utf8"));
    } catch {
      continue;
    }
    const source = snapshotBySourceId.get(manifest.boardId);
    if (!source) continue;
    const snapshot = source.snapshot as Record<string, unknown>;
    if (snapshot.kind !== BOARD_SNAPSHOT_KIND || snapshot.version !== BOARD_PROTOCOL_VERSION) {
      throw new Error(`Unsupported Board snapshot version: ${String(snapshot.version)}`);
    }
    const sourceBoard = snapshot.board && typeof snapshot.board === "object" && !Array.isArray(snapshot.board)
      ? snapshot.board as Record<string, unknown>
      : {};
    const boardId = crypto.randomUUID();
    const now = new Date();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(boards).values({
          id: boardId,
          spaceId: input.targetSpaceId,
          title: typeof sourceBoard.title === "string" ? sourceBoard.title : manifest.title,
          version: source.sourceVersion,
          metadata: {
            ...(sourceBoard.metadata && typeof sourceBoard.metadata === "object" ? sourceBoard.metadata as Record<string, unknown> : {}),
            restoredFrom: {
              checkpointId: input.checkpointId,
              sourceBoardId: source.sourceBoardId,
              sourceVersion: source.sourceVersion,
            },
          },
          createdAt: now,
          updatedAt: now,
        });

        const items = records(snapshot.items);
        const nodes = items.map((item, index) => boardAuthoringItemToNode(item, {
          orderKey: String(index + 1).padStart(8, "0"),
        }));
        if (nodes.length) await tx.insert(boardNodes).values(nodes.map((node) => ({
          ...node,
          boardId,
          version: source.sourceVersion,
          createdAt: now,
          updatedAt: now,
        })));

        // Connections are restored after nodes so the relation set is only ever
        // written alongside the nodes it references. Endpoints missing from the
        // snapshot are dropped rather than restored dangling: the snapshot is the
        // authority for what existed, and an edge to an absent node did not.
        const restoredNodeIds = new Set(nodes.map((node) => node.nodeId));
        const connectionRows = restoreBoardConnectionRows(
          records(snapshot.connections) as Parameters<typeof restoreBoardConnectionRows>[0],
          boardId,
          restoredNodeIds,
          now,
        );
        if (connectionRows.length) await tx.insert(boardConnections).values(connectionRows);

        const effects = records(snapshot.effects);
        if (effects.length) await tx.insert(boardEffects).values(effects.map((effect) => {
          const target = effect.target && typeof effect.target === "object" && !Array.isArray(effect.target)
            ? effect.target as Record<string, unknown>
            : null;
          const targetType = typeof target?.type === "string" ? target.type : String(effect.targetType ?? "board");
          const targetId = targetType === "item" && typeof target?.itemId === "string"
            ? target.itemId
            : typeof effect.targetId === "string" ? effect.targetId : null;
          return {
          id: String(effect.id),
          boardId,
          targetType,
          targetId,
          kind: String(effect.kind),
          kindVersion: Number(effect.kindVersion),
          enabled: effect.enabled !== false,
          lifecycle: String(effect.lifecycle),
          timeOrigin: String(effect.timeOrigin),
          layer: String(effect.layer),
          seed: String(effect.seed),
          params: effect.params as Record<string, unknown> ?? {},
          assetRefs: records(effect.assetRefs),
          metadata: effect.metadata as Record<string, unknown> ?? {},
          revision: Number(effect.revision ?? 0),
          createdAt: now,
          updatedAt: now,
        };
        }));

        const compositions = records(snapshot.compositions);
        if (compositions.length) {
          await tx.insert(boardCompositions).values(compositions.map((composition) => {
            const timeline = composition.timeline as Record<string, unknown> ?? {};
            return {
              id: String(composition.id),
              boardId,
              name: String(composition.name),
              duration: Number(timeline.duration),
              playback: composition.playback as Record<string, unknown> ?? {},
              markers: records(timeline.markers),
              metadata: composition.metadata as Record<string, unknown> ?? {},
              revision: Number(composition.revision ?? 0),
              createdAt: now,
              updatedAt: now,
            };
          }));
          const tracks = compositions.flatMap((composition) => {
            const timeline = composition.timeline as Record<string, unknown> ?? {};
            return records(timeline.tracks).map((track) => ({
              id: String(track.id),
              boardId,
              compositionId: String(composition.id),
              target: track.target as Record<string, unknown>,
              channel: String(track.channel),
              channelVersion: Number(track.channelVersion),
              interpolation: String(track.interpolation),
              fill: String(track.fill),
              keyframes: records(track.keyframes),
              metadata: track.metadata as Record<string, unknown> ?? {},
            }));
          });
          if (tracks.length) await tx.insert(boardTracks).values(tracks);
          const clips = compositions.flatMap((composition) => {
            const timeline = composition.timeline as Record<string, unknown> ?? {};
            return records(timeline.clips).map((clip) => ({
              id: String(clip.id),
              boardId,
              compositionId: String(composition.id),
              kind: String(clip.kind),
              kindVersion: Number(clip.kindVersion),
              target: clip.target as Record<string, unknown>,
              start: Number(clip.start),
              duration: Number(clip.duration),
              layer: String(clip.layer),
              fill: String(clip.fill),
              easing: String(clip.easing),
              params: clip.params as Record<string, unknown> ?? {},
              assetRefs: records(clip.assetRefs),
              seed: String(clip.seed),
              metadata: clip.metadata as Record<string, unknown> ?? {},
            }));
          });
          if (clips.length) await tx.insert(boardClips).values(clips);
        }
      });

      const temporaryPath = `${absolutePath}.cohub-restore-${boardId}.tmp`;
      try {
        await writeFile(temporaryPath, serializeBoardManifest({ ...manifest, boardId }), { flag: "wx" });
        await rename(temporaryPath, absolutePath);
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }
      restored.push({ path: relative(resolve(input.workspaceDir), absolutePath).replaceAll("\\", "/"), boardId });
    } catch (error) {
      await db.delete(boards).where(and(eq(boards.id, boardId), eq(boards.spaceId, input.targetSpaceId))).catch(() => undefined);
      throw error;
    }
  }
  return { count: restored.length, restored };
}
