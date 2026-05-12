import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.js";
import { useAuth } from "../lib/middleware.js";

const router = new Hono();
const MIN_QUERY_LENGTH = 2;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

type SearchResourceType = "turn" | "session" | "space";
type SearchMatchedField = "userText" | "title" | "name" | "description";

type SearchResultRow = {
  type: SearchResourceType;
  id: string;
  spaceId: string;
  sessionId: string | null;
  turnId: string | null;
  sequence: number | null;
  title: string;
  excerpt: string | null;
  spaceName: string | null;
  sessionTitle: string | null;
  matchedField: SearchMatchedField;
  updatedAt: Date | string | null;
  textScore: number;
  recencyScore: number;
  typePriorityScore: number;
  score: number;
};

function clampLimit(value: string | undefined) {
  const parsed = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), MAX_LIMIT);
}

function normalizeQuery(value: string | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function hasInformativeQuery(value: string) {
  return /[\p{L}\p{N}]/u.test(value);
}

function toIso(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function hrefFor(row: SearchResultRow) {
  if (row.type === "space") return `/spaces/${row.spaceId}`;
  if (row.type === "session") return `/spaces/${row.spaceId}/sessions/${row.sessionId}`;
  return `/spaces/${row.spaceId}/sessions/${row.sessionId}?turn=${row.sequence}`;
}

function mapRow(row: SearchResultRow) {
  return {
    type: row.type,
    id: row.id,
    spaceId: row.spaceId,
    sessionId: row.sessionId,
    turnId: row.turnId,
    sequence: row.sequence,
    title: row.title,
    excerpt: row.excerpt,
    spaceName: row.spaceName,
    sessionTitle: row.sessionTitle,
    matchedField: row.matchedField,
    href: hrefFor(row),
    score: Number(row.score ?? 0),
    textScore: Number(row.textScore ?? 0),
    recencyScore: Number(row.recencyScore ?? 0),
    typePriorityScore: Number(row.typePriorityScore ?? 0),
    updatedAt: toIso(row.updatedAt),
    source: "remote" as const,
  };
}

router.get("/", async (c) => {
  const user = useAuth(c);
  const q = normalizeQuery(c.req.query("q"));
  const escapedQ = escapeLikePattern(q);
  const limit = clampLimit(c.req.query("limit"));

  if (q.length < MIN_QUERY_LENGTH || !hasInformativeQuery(q)) {
    return c.json({ items: [], query: q, source: "remote" });
  }

  try {
    const rows = await db.execute<SearchResultRow>(sql`
    WITH visible_spaces AS (
      SELECT DISTINCT s.*
      FROM v2.spaces s
      LEFT JOIN v2.space_members sm
        ON sm.space_id = s.id AND sm.user_id = ${user.uuid}
      WHERE s.user_uuid = ${user.uuid} OR sm.user_id IS NOT NULL
    ),
    space_results AS (
      SELECT
        'space'::text AS type,
        s.id AS id,
        s.id AS space_id,
        NULL::uuid AS session_id,
        NULL::uuid AS turn_id,
        NULL::int AS sequence,
        s.name AS title,
        CASE
          WHEN coalesce(s.description, '') = '' THEN NULL::text
          ELSE left(regexp_replace(s.description, '\\s+', ' ', 'g'), 220)
        END AS excerpt,
        s.name AS space_name,
        NULL::text AS session_title,
        'name'::text AS matched_field,
        coalesce(s.updated_at, s.created_at) AS updated_at,
        GREATEST(
          CASE
            WHEN lower(s.name) = lower(${q}) THEN 1.00
            WHEN lower(s.name) LIKE lower(${escapedQ}) || '%' ESCAPE '\\' THEN 0.92
            WHEN s.name ILIKE '%' || ${escapedQ} || '%' ESCAPE '\\' THEN 0.74
            ELSE similarity(s.name, ${q}) * 0.70
          END * 0.90,
          CASE
            WHEN lower(coalesce(s.description, '')) = lower(${q}) THEN 1.00
            WHEN lower(coalesce(s.description, '')) LIKE lower(${escapedQ}) || '%' ESCAPE '\\' THEN 0.88
            WHEN coalesce(s.description, '') ILIKE '%' || ${escapedQ} || '%' ESCAPE '\\' THEN 0.68
            ELSE similarity(coalesce(s.description, ''), ${q}) * 0.58
          END * 0.68
        ) AS text_score,
        0.33::double precision AS type_priority_score
      FROM visible_spaces s
      WHERE
        s.name ILIKE '%' || ${escapedQ} || '%' ESCAPE '\\'
        OR coalesce(s.description, '') ILIKE '%' || ${escapedQ} || '%' ESCAPE '\\'
        OR similarity(s.name, ${q}) > 0.2
        OR similarity(coalesce(s.description, ''), ${q}) > 0.2
    ),
    session_results AS (
      SELECT
        'session'::text AS type,
        sess.id AS id,
        sess.space_id AS space_id,
        sess.id AS session_id,
        NULL::uuid AS turn_id,
        NULL::int AS sequence,
        coalesce(nullif(sess.title, ''), 'Untitled session') AS title,
        NULL::text AS excerpt,
        sp.name AS space_name,
        sess.title AS session_title,
        'title'::text AS matched_field,
        coalesce(sess.last_message_at, sess.updated_at, sess.created_at) AS updated_at,
        CASE
          WHEN lower(coalesce(sess.title, '')) = lower(${q}) THEN 1.00
          WHEN lower(coalesce(sess.title, '')) LIKE lower(${escapedQ}) || '%' ESCAPE '\\' THEN 0.92
          WHEN coalesce(sess.title, '') ILIKE '%' || ${escapedQ} || '%' ESCAPE '\\' THEN 0.74
          ELSE similarity(coalesce(sess.title, ''), ${q}) * 0.70
        END * 0.94 AS text_score,
        0.66::double precision AS type_priority_score
      FROM v2.space_sessions sess
      JOIN visible_spaces sp ON sp.id = sess.space_id
      WHERE
        coalesce(sess.title, '') ILIKE '%' || ${escapedQ} || '%' ESCAPE '\\'
        OR similarity(coalesce(sess.title, ''), ${q}) > 0.2
    ),
    turn_results AS (
      SELECT
        'turn'::text AS type,
        t.id AS id,
        sess.space_id AS space_id,
        sess.id AS session_id,
        t.id AS turn_id,
        t.sequence AS sequence,
        left(regexp_replace(coalesce(t.user_text, ''), '\\s+', ' ', 'g'), 140) AS title,
        left(regexp_replace(coalesce(t.user_text, ''), '\\s+', ' ', 'g'), 260) AS excerpt,
        sp.name AS space_name,
        sess.title AS session_title,
        'userText'::text AS matched_field,
        coalesce(t.updated_at, t.created_at) AS updated_at,
        CASE
          WHEN lower(coalesce(t.user_text, '')) = lower(${q}) THEN 1.00
          WHEN lower(coalesce(t.user_text, '')) LIKE lower(${escapedQ}) || '%' ESCAPE '\\' THEN 0.92
          WHEN coalesce(t.user_text, '') ILIKE '%' || ${escapedQ} || '%' ESCAPE '\\' THEN 0.74
          ELSE similarity(coalesce(t.user_text, ''), ${q}) * 0.70
        END AS text_score,
        1.00::double precision AS type_priority_score
      FROM v2.session_turns t
      JOIN v2.space_sessions sess ON sess.id = t.session_id
      JOIN visible_spaces sp ON sp.id = sess.space_id
      WHERE
        t.user_text IS NOT NULL
        AND (
          t.user_text ILIKE '%' || ${escapedQ} || '%' ESCAPE '\\'
          OR similarity(t.user_text, ${q}) > 0.2
        )
    ),
    combined AS (
      SELECT * FROM turn_results
      UNION ALL
      SELECT * FROM session_results
      UNION ALL
      SELECT * FROM space_results
    ),
    scored AS (
      SELECT
        *,
        1.0 / (1.0 + EXTRACT(EPOCH FROM (now() - updated_at)) / 86400.0 / 30.0) AS recency_score
      FROM combined
    )
    SELECT
      type,
      id,
      space_id AS "spaceId",
      session_id AS "sessionId",
      turn_id AS "turnId",
      sequence,
      title,
      excerpt,
      space_name AS "spaceName",
      session_title AS "sessionTitle",
      matched_field AS "matchedField",
      updated_at AS "updatedAt",
      text_score AS "textScore",
      recency_score AS "recencyScore",
      type_priority_score AS "typePriorityScore",
      (text_score * 0.76 + recency_score * 0.18 + type_priority_score * 0.06) AS score
    FROM scored
    ORDER BY score DESC, text_score DESC, type_priority_score DESC, updated_at DESC
    LIMIT ${limit}
  `);

    return c.json({ items: rows.map(mapRow), query: q, source: "remote" });
  } catch (error) {
    console.warn("[search] global search failed", {
      userUuid: user.uuid,
      queryLength: q.length,
      error,
    });
    return c.json({ items: [], query: q, source: "remote", degraded: true });
  }
});

export default router;
