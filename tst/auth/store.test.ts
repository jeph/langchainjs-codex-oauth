import { mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

import { NotAuthenticatedError } from "../../src/errors.js"
import { AuthStore } from "../../src/auth/store.js"

describe("AuthStore", () => {
  test("saves and loads credentials", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "codex-auth-store-"))
    const authPath = path.join(dir, "auth.json")
    const store = new AuthStore(authPath)

    await store.save({
      type: "oauth",
      access: "access",
      refresh: "refresh",
      expires: 123,
      accountId: "acct_123",
    })

    await expect(store.load()).resolves.toEqual({
      type: "oauth",
      access: "access",
      refresh: "refresh",
      expires: 123,
      accountId: "acct_123",
    })

    await expect(readFile(authPath, "utf8")).resolves.toContain("acct_123")
  })

  test("throws when credentials are missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "codex-auth-store-"))
    const store = new AuthStore(path.join(dir, "missing.json"))

    await expect(store.load()).rejects.toBeInstanceOf(NotAuthenticatedError)
  })

  test.skipIf(process.platform === "win32")(
    "writes credential files with owner-only permissions",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "codex-auth-store-"))
      const authPath = path.join(dir, "auth.json")
      const store = new AuthStore(authPath)

      await store.save({
        type: "oauth",
        access: "access",
        refresh: "refresh",
        expires: 123,
        accountId: "acct_123",
      })

      const authStat = await stat(authPath)
      expect(authStat.mode & 0o077).toBe(0)
    },
  )
})
