import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { CodexClient } from "../src/client/index.js"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function jwtForAccount(accountId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": {
        chatgpt_account_id: accountId,
      },
    }),
  ).toString("base64url")

  return `header.${payload}.signature`
}

function tokenResponse(input: {
  access: string
  refresh: string
  expiresIn?: number
}): Response {
  return new Response(
    JSON.stringify({
      access_token: input.access,
      refresh_token: input.refresh,
      expires_in: input.expiresIn ?? 3600,
    }),
    { status: 200 },
  )
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 1_000

  while (Date.now() < deadline) {
    if (await predicate()) {
      return
    }

    await sleep(10)
  }

  throw new Error(message)
}

async function writeCredentials(
  authPath: string,
  input: {
    access?: string
    refresh?: string
    expires: number
    accountId?: string
  },
): Promise<void> {
  await writeFile(
    authPath,
    `${JSON.stringify(
      {
        type: "oauth",
        access: input.access ?? "access_initial",
        refresh: input.refresh ?? "refresh_initial",
        expires: input.expires,
        account_id: input.accountId ?? "acct_initial",
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
}

async function readCredentials(
  authPath: string,
): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(authPath, "utf8")) as Record<string, unknown>
}

async function verifyDefaultPollingRefreshesOncePerAuthPath(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "lcjs-codex-refresh-"))
  const authPath = path.join(root, "auth.json")
  const access = jwtForAccount("acct_refreshed")
  const refreshTokens: string[] = []
  let refreshCalls = 0

  await writeCredentials(authPath, { expires: Date.now() - 1_000 })

  const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
    refreshCalls += 1

    if (init?.body instanceof URLSearchParams) {
      refreshTokens.push(init.body.get("refresh_token") ?? "")
    }

    await sleep(50)

    return tokenResponse({ access, refresh: "refresh_rotated" })
  }

  const clients = [
    new CodexClient({
      authPath,
      fetchFn,
      backgroundAuthRefresh: { intervalMs: 10, refreshBeforeExpiryMs: 60_000 },
    }),
    new CodexClient({
      authPath,
      fetchFn,
      backgroundAuthRefresh: { intervalMs: 10, refreshBeforeExpiryMs: 60_000 },
    }),
  ]

  try {
    await waitFor(async () => {
      const creds = await readCredentials(authPath)
      return creds.refresh === "refresh_rotated"
    }, "background poller did not refresh the auth file")

    await sleep(75)

    const creds = await readCredentials(authPath)

    assert(refreshCalls === 1, `expected 1 refresh call, got ${refreshCalls}`)
    assert(
      refreshTokens.length === 1 && refreshTokens[0] === "refresh_initial",
      `expected one refresh token use, got ${JSON.stringify(refreshTokens)}`,
    )
    assert(creds.access === access, "auth file did not save refreshed access")
    assert(
      creds.account_id === "acct_refreshed",
      "auth file did not save refreshed account id",
    )
  } finally {
    for (const client of clients) {
      client.stopBackgroundAuthRefresh()
    }

    await rm(root, { force: true, recursive: true })
  }
}

async function verifyOptOutDoesNotPoll(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "lcjs-codex-refresh-off-"))
  const authPath = path.join(root, "auth.json")
  let refreshCalls = 0

  await writeCredentials(authPath, { expires: Date.now() - 1_000 })

  const client = new CodexClient({
    authPath,
    fetchFn: async () => {
      refreshCalls += 1
      return tokenResponse({
        access: jwtForAccount("acct_should_not_refresh"),
        refresh: "refresh_should_not_rotate",
      })
    },
    backgroundAuthRefresh: false,
  })

  try {
    await sleep(75)

    const creds = await readCredentials(authPath)

    assert(refreshCalls === 0, `expected 0 refresh calls, got ${refreshCalls}`)
    assert(
      creds.refresh === "refresh_initial",
      "disabled background refresh unexpectedly changed auth file",
    )
  } finally {
    client.stopBackgroundAuthRefresh()
    await rm(root, { force: true, recursive: true })
  }
}

await verifyDefaultPollingRefreshesOncePerAuthPath()
await verifyOptOutDoesNotPoll()

console.log("background auth refresh behavior verified")
