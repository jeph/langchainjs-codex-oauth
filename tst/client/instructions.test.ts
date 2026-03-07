import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"

import {
  getCodexInstructions,
  INSTRUCTIONS_MODE_ENV,
} from "../../src/client/instructions.js"

describe("instruction resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test("bundled mode returns fallback prompt", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "codex-instructions-"))
    vi.stubEnv("LANGCHAINJS_CODEX_OAUTH_HOME", dir)
    vi.stubEnv(INSTRUCTIONS_MODE_ENV, "bundled")

    const text = await getCodexInstructions("gpt-5.2-codex", vi.fn())

    expect(text.length).toBeGreaterThan(100)
    expect(text.toLowerCase()).toContain("you are codex")
  })

  test("cache mode throws when cache is missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "codex-instructions-"))
    vi.stubEnv("LANGCHAINJS_CODEX_OAUTH_HOME", dir)
    vi.stubEnv(INSTRUCTIONS_MODE_ENV, "cache")

    await expect(
      getCodexInstructions("gpt-5.2-codex", vi.fn()),
    ).rejects.toThrow(/Instructions cache is missing/u)
  })
})
