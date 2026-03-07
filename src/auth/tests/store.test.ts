import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { NotAuthenticatedError } from "../../errors.js";
import { AuthStore } from "../store.js";

describe("AuthStore", () => {
  test("saves and loads credentials", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "codex-auth-store-"));
    const authPath = path.join(dir, "auth.json");
    const store = new AuthStore(authPath);

    await store.save({
      type: "oauth",
      access: "access",
      refresh: "refresh",
      expires: 123,
      accountId: "acct_123",
    });

    await expect(store.load()).resolves.toEqual({
      type: "oauth",
      access: "access",
      refresh: "refresh",
      expires: 123,
      accountId: "acct_123",
    });

    await expect(readFile(authPath, "utf8")).resolves.toContain("acct_123");
  });

  test("throws when credentials are missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "codex-auth-store-"));
    const store = new AuthStore(path.join(dir, "missing.json"));

    await expect(store.load()).rejects.toBeInstanceOf(NotAuthenticatedError);
  });
});
