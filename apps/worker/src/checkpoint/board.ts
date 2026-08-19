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
  isBoardPath,
  parseBoardManifest,
  serializeBoardManifest,
  upgradeBoardSnapshot,
} from "@cohub/protocol";
import { db } from "../db.js";
import { captureBoardSnapshots } from "./board-snapshot.js";

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
    const snapshot = upgradeBoardSnapshot(source.snapshot) as unknown as Record<string, unknown>;
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

        const nodes = records(snapshot.nodes);
        if (nodes.length) await tx.insert(boardNodes).values(nodes.map((node, index) => ({
          boardId,
          nodeId: String(node.nodeId),
          type: String(node.type ?? "unknown"),
          parentId: typeof node.parentId === "string" ? node.parentId : null,
          orderKey: typeof node.orderKey === "string" ? node.orderKey : String(index).padStart(8, "0"),
          x: typeof node.x === "number" ? node.x : 0,
          y: typeof node.y === "number" ? node.y : 0,
          width: typeof node.width === "number" ? node.width : 240,
          height: typeof node.height === "number" ? node.height : 160,
          rotation: typeof node.rotation === "number" ? node.rotation : 0,
          refKind: typeof node.refKind === "string" ? node.refKind : null,
          refPath: typeof node.refPath === "string" ? node.refPath : null,
          refUrl: typeof node.refUrl === "string" ? node.refUrl : null,
          view: node.view && typeof node.view === "object" ? node.view as Record<string, unknown> : {},
          style: node.style && typeof node.style === "object" ? node.style as Record<string, unknown> : {},
          data: node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {},
          version: source.sourceVersion,
          createdAt: now,
          updatedAt: now,
        })));

        // Connections are restored after nodes so the relation set is only ever
        // written alongside the nodes it references. Endpoints missing from the
        // snapshot are dropped rather than restored dangling: the snapshot is the
        // authority for what existed, and an edge to an absent node did not.
        const restoredNodeIds = new Set(nodes.map((node) => String(node.nodeId)));
        const connections = records(snapshot.connections).filter((connection) => {
          const source = connection.source as { nodeId?: unknown } | undefined;
          const target = connection.target as { nodeId?: unknown } | undefined;
          return (
            typeof source?.nodeId === "string" &&
            typeof target?.nodeId === "string" &&
            restoredNodeIds.has(source.nodeId) &&
            restoredNodeIds.has(target.nodeId)
          );
        });
        if (connections.length) await tx.insert(boardConnections).values(connections.map((connection) => {
          const source = connection.source as { nodeId: string; anchor?: unknown };
          const target = connection.target as { nodeId: string; anchor?: unknown };
          const anchor = (value: unknown) =>
            value && typeof value === "object" && !Array.isArray(value)
              ? value as Record<string, unknown>
              : { kind: "auto" };
          const group = (value: unknown) =>
            value && typeof value === "object" && !Array.isArray(value)
              ? value as Record<string, unknown>
              : {};
          return {
            boardId,
            connectionId: String(connection.id),
            sourceNodeId: source.nodeId,
            targetNodeId: target.nodeId,
            relation: typeof connection.relation === "string" ? connection.relation : "related",
            direction: typeof connection.direction === "string" ? connection.direction : "forward",
            label: typeof connection.label === "string" ? connection.label : "",
            sourceAnchor: anchor(source.anchor),
            targetAnchor: anchor(target.anchor),
            routing: group(connection.routing),
            style: group(connection.style),
            metadata: group(connection.metadata),
            revision: Number(connection.revision ?? 0),
            createdAt: now,
            updatedAt: now,
          };
        }));

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
