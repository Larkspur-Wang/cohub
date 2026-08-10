import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getPostgresErrorCode,
  getPostgresErrorConstraint,
  isPostgresUniqueViolation,
} from "./postgres-error.js";

describe("PostgreSQL errors", () => {
  it("reads direct driver errors", () => {
    const error = { code: "23505", constraint: "example_unique" };
    assert.equal(getPostgresErrorCode(error), "23505");
    assert.equal(getPostgresErrorConstraint(error), "example_unique");
    assert.equal(isPostgresUniqueViolation(error, "example_unique"), true);
  });

  it("unwraps Drizzle cause chains", () => {
    const error = new Error("Failed query", {
      cause: new Error("Driver wrapper", {
        cause: { code: "23505", constraint_name: "wrapped_unique" },
      }),
    });
    assert.equal(getPostgresErrorCode(error), "23505");
    assert.equal(getPostgresErrorConstraint(error), "wrapped_unique");
  });

  it("ignores non-SQLSTATE wrapper codes", () => {
    const error = {
      code: "ETIMEDOUT",
      cause: { code: "23505", constraint: "wrapped_unique" },
    };
    assert.equal(getPostgresErrorCode(error), "23505");
    assert.equal(getPostgresErrorConstraint(error), "wrapped_unique");
  });

  it("stops on cyclic cause chains", () => {
    const error: { cause?: unknown } = {};
    error.cause = error;
    assert.equal(getPostgresErrorCode(error), null);
    assert.equal(getPostgresErrorConstraint(error), null);
  });
});
