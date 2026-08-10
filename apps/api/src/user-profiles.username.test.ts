import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDefaultUsernameCandidates,
  isRecoverableUsernameReconciliationError,
  normalizeUsername,
  resolveSyncedUsername,
  resolveTrustedLogtoUserId,
  slugifyUsernameBase,
  usernameBaseFromEmail,
} from "./user-profiles.js";

describe("resolveTrustedLogtoUserId", () => {
  const userUuid = "11111111-2222-4333-8444-555555555555";

  it("prefers a verified token subject", () => {
    assert.equal(resolveTrustedLogtoUserId({
      userUuid,
      tokenLogtoUserId: " logto-user ",
      storedLogtoUserId: "stale-user",
    }), "logto-user");
  });

  it("reuses a stored identity when the token has no subject", () => {
    assert.equal(resolveTrustedLogtoUserId({
      userUuid,
      storedLogtoUserId: "logto-user",
    }), "logto-user");
  });

  it("rejects missing and guessed stored identities", () => {
    assert.equal(resolveTrustedLogtoUserId({ userUuid }), null);
    assert.equal(resolveTrustedLogtoUserId({
      userUuid,
      storedLogtoUserId: userUuid,
    }), null);
  });
});

describe("usernameBaseFromEmail", () => {
  it("slugifies email local parts", () => {
    assert.equal(usernameBaseFromEmail("Alice.Smith+tag@example.com"), "alicesmithtag");
    assert.equal(usernameBaseFromEmail("  bob@example.com "), "bob");
  });

  it("returns null for empty or unusable emails", () => {
    assert.equal(usernameBaseFromEmail(null), null);
    assert.equal(usernameBaseFromEmail(""), null);
    assert.equal(usernameBaseFromEmail("@example.com"), null);
    assert.equal(usernameBaseFromEmail("你好@example.com"), null);
    assert.equal(usernameBaseFromEmail("123@example.com"), null);
  });
});

describe("isRecoverableUsernameReconciliationError", () => {
  it("accepts conflicts and temporary Logto failures", () => {
    assert.equal(isRecoverableUsernameReconciliationError(
      new Error("Logto management request failed: 409 conflict"),
    ), true);
    assert.equal(isRecoverableUsernameReconciliationError(
      new Error("Logto management request failed: 503 unavailable"),
    ), true);
    assert.equal(isRecoverableUsernameReconciliationError(
      new TypeError("fetch failed"),
    ), true);
  });

  it("rejects persistent and unrelated failures", () => {
    assert.equal(isRecoverableUsernameReconciliationError(
      new Error("Logto management request failed: 401 unauthorized"),
    ), false);
    assert.equal(isRecoverableUsernameReconciliationError(
      { code: "ETIMEDOUT", message: "database query failed" },
    ), false);
    assert.equal(isRecoverableUsernameReconciliationError(
      new SyntaxError("invalid Logto response"),
    ), false);
  });
});

describe("normalizeUsername", () => {
  it("keeps reserved historical values readable", () => {
    assert.equal(normalizeUsername(" Changelog "), "changelog");
    assert.equal(normalizeUsername("bad--name"), null);
  });
});

describe("resolveSyncedUsername", () => {
  it("accepts ordinary synced usernames", () => {
    assert.equal(resolveSyncedUsername("alice", null), "alice");
  });

  it("keeps only the same stored reserved username", () => {
    assert.equal(resolveSyncedUsername("docs", "docs"), "docs");
    assert.equal(resolveSyncedUsername("docs", null), null);
    assert.equal(resolveSyncedUsername("docs", "admin"), null);
  });
});

describe("slugifyUsernameBase", () => {
  it("removes separators and trims edges", () => {
    assert.equal(slugifyUsernameBase("--Hello__World!!"), "helloworld");
  });

  it("rejects reserved-incompatible empty results", () => {
    assert.equal(slugifyUsernameBase("---"), null);
  });
});

describe("buildDefaultUsernameCandidates", () => {
  it("prefers bare email base then random suffixes then uuid fallback", () => {
    const candidates = buildDefaultUsernameCandidates({
      email: "alice@example.com",
      userUuid: "11111111-2222-4333-8444-555555555555",
      randomSuffixCount: 3,
    });

    assert.equal(candidates[0], "alice");
    assert.ok(candidates.some((value) => /^alice\d+$/.test(value)));
    assert.ok(candidates.some((value) => value.startsWith("u")));
    assert.equal(new Set(candidates).size, candidates.length);
    for (const candidate of candidates) {
      assert.match(candidate, /^[a-z][a-z0-9]*$/);
      assert.equal(normalizeUsername(candidate), candidate);
    }
  });

  it("prefers the conflicting username base during reconciliation", () => {
    const candidates = buildDefaultUsernameCandidates({
      email: "other@example.com",
      preferredUsername: " Kinori ",
      userUuid: "11111111-2222-4333-8444-555555555555",
      randomSuffixCount: 2,
    });

    assert.equal(candidates[0], "kinori");
    assert.ok(candidates.some((value) => /^kinori\d+$/.test(value)));
    assert.ok(candidates.indexOf("kinori") < candidates.indexOf("other"));
  });

  it("skips reserved bare base but still uses suffixed forms", () => {
    const candidates = buildDefaultUsernameCandidates({
      email: "admin@example.com",
      userUuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      randomSuffixCount: 4,
    });

    assert.ok(!candidates.includes("admin"));
    assert.ok(candidates.some((value) => /^admin\d+$/.test(value)));
  });

  it("falls back without email", () => {
    const candidates = buildDefaultUsernameCandidates({
      email: null,
      userUuid: "deadbeef-0000-4000-8000-ffffffffffff",
      randomSuffixCount: 0,
    });

    assert.ok(candidates.length >= 1);
    assert.ok(candidates.every((value) => value.startsWith("u")));
    assert.ok(candidates.every((value) => /^[a-z][a-z0-9]*$/.test(value)));
  });
});
