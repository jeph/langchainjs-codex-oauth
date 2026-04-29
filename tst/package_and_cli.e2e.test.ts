import { execFile as execFileCallback } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { describe, expect, test } from "vitest"

const execFile = promisify(execFileCallback)
const rootDir = fileURLToPath(new URL("..", import.meta.url))
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string }

describe("published package and CLI e2e", () => {
  test("recovers invoke output through the published package exports", async () => {
    const script = [
      'import { ChatCodexOAuth } from "langchainjs-codex-oauth"',
      'import { CodexClient } from "langchainjs-codex-oauth/client"',
      'import { HumanMessage } from "@langchain/core/messages"',
      "const encoder = new TextEncoder()",
      "const streamFromText = (text) => new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(text)); controller.close() } })",
      "const sse = [",
      '  "data: {\\"type\\":\\"response.output_text.delta\\",\\"delta\\":\\"I\\"}\\n\\n",',
      '  "data: {\\"type\\":\\"response.output_text.delta\\",\\"delta\\":\\" love\\"}\\n\\n",',
      '  "data: {\\"type\\":\\"response.output_text.delta\\",\\"delta\\":\\" you\\"}\\n\\n",',
      '  "data: {\\"type\\":\\"response.done\\",\\"response\\":{\\"output\\":[],\\"status\\":\\"completed\\"}}\\n\\n",',
      '].join("")',
      'const authStore = { load: async () => ({ type: "oauth", access: "access", refresh: "refresh", expires: Date.now() + 60_000, accountId: "acct_123" }) }',
      'const fetchFn = async () => new Response(streamFromText(sse), { status: 200, headers: { "Content-Type": "text/event-stream" } })',
      'const model = new ChatCodexOAuth({ model: "gpt-5.5" })',
      'Reflect.set(model, "client", new CodexClient({ authStore, fetchFn, maxRetries: 0 }))',
      'const result = await model.invoke([new HumanMessage("hi")])',
      "process.stdout.write(JSON.stringify({ text: result.text }))",
    ].join("\n")
    const { stdout } = await execFile(
      process.execPath,
      ["--input-type=module", "--eval", script],
      {
        cwd: rootDir,
      },
    )

    expect(JSON.parse(stdout)).toEqual({ text: "I love you" })
  })

  test("prints the built CLI version", async () => {
    const { stdout } = await execFile(
      process.execPath,
      ["./bin/langchainjs-codex-oauth.js", "--version"],
      {
        cwd: rootDir,
      },
    )

    expect(stdout.trim()).toBe(pkg.version)
  })

  test("prints the built CLI auth status", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "lcjs-codex-cli-"))
    const authPath = path.join(tempDir, "openai.json")

    try {
      await writeFile(
        authPath,
        `${JSON.stringify(
          {
            type: "oauth",
            access: "access",
            refresh: "refresh",
            expires: 1_893_456_000_000,
            account_id: "acct_123",
          },
          null,
          2,
        )}\n`,
        "utf8",
      )

      const { stdout } = await execFile(
        process.execPath,
        ["./bin/langchainjs-codex-oauth.js", "auth", "status"],
        {
          cwd: rootDir,
          env: {
            ...process.env,
            LANGCHAINJS_CODEX_OAUTH_AUTH_PATH: authPath,
          },
        },
      )

      expect(stdout).toContain("Logged in: yes")
      expect(stdout).toContain("Account id: acct_123")
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  })
})
