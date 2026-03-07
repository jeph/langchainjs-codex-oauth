import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"

import { AuthStore } from "./auth/store.js"
import {
  buildAuthorizeUrl,
  createState,
  decodeJwtPayload,
  exchangeAuthorizationCode,
  extractChatGPTAccountId,
  generatePkce,
  openInBrowser,
  parseAuthorizationInput,
  runLocalCallbackServer,
} from "./auth/oauth.js"
import {
  NotAuthenticatedError,
  OAuthFlowError,
  TokenRefreshError,
} from "./errors.js"
import { VERSION } from "./version.js"

function usage(): string {
  return [
    "Usage:",
    "  langchainjs-codex-oauth auth login [--manual] [--timeout-s 180]",
    "  langchainjs-codex-oauth auth status",
    "  langchainjs-codex-oauth auth logout",
    "  langchainjs-codex-oauth --version",
  ].join("\n")
}

function formatMs(ms: number): string {
  if (!ms) {
    return "unknown"
  }

  return new Date(ms).toISOString()
}

async function prompt(message: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout })

  try {
    return await rl.question(message)
  } finally {
    rl.close()
  }
}

function parseLoginArgs(args: string[]): {
  manual: boolean
  timeoutMs: number
} {
  const parsed = args.reduce(
    (state, arg, index) => {
      if (state.skipNext) {
        return { ...state, skipNext: false }
      }

      if (arg === "--manual") {
        return { ...state, manual: true }
      }

      if (arg === "--timeout-s") {
        const raw = args[index + 1]

        if (!raw) {
          throw new OAuthFlowError("Missing value for --timeout-s.")
        }

        const seconds = Number.parseInt(raw, 10)

        if (!Number.isInteger(seconds) || seconds <= 0) {
          throw new OAuthFlowError("--timeout-s must be a positive integer.")
        }

        return {
          ...state,
          timeoutMs: seconds * 1000,
          skipNext: true,
        }
      }

      throw new OAuthFlowError(`Unknown argument: ${arg}`)
    },
    { manual: false, timeoutMs: 180_000, skipNext: false },
  )

  return {
    manual: parsed.manual,
    timeoutMs: parsed.timeoutMs,
  }
}

function createLoginSession(): {
  state: string
  verifier: string
  url: string
} {
  const pkce = generatePkce()
  const state = createState()

  return {
    state,
    verifier: pkce.verifier,
    url: buildAuthorizeUrl({
      state,
      codeChallenge: pkce.challenge,
    }),
  }
}

function assertOAuthState(actual: string | undefined, expected: string): void {
  if (!actual) {
    throw new OAuthFlowError("OAuth state missing.")
  }

  if (actual !== expected) {
    throw new OAuthFlowError("OAuth state mismatch.")
  }
}

async function authorizeManually(session: {
  state: string
  verifier: string
  url: string
}): Promise<{ code: string; verifier: string }> {
  stdout.write(
    `Open this URL in your browser and complete login:\n\n${session.url}\n\n`,
  )
  const pasted = await prompt(
    "Paste the full redirect URL or authorization code here:\n> ",
  )
  const parsed = parseAuthorizationInput(pasted)

  if (!parsed.code) {
    throw new OAuthFlowError("No authorization code provided.")
  }

  assertOAuthState(parsed.state, session.state)

  return {
    code: parsed.code,
    verifier: session.verifier,
  }
}

async function authorizeInBrowser(
  session: {
    state: string
    verifier: string
    url: string
  },
  timeoutMs: number,
): Promise<{ code: string; verifier: string }> {
  stdout.write(`Opening browser for ChatGPT OAuth...\n\n${session.url}\n\n`)
  const waitForCallback = runLocalCallbackServer(timeoutMs)
  const opened = await openInBrowser(session.url)

  if (!opened) {
    stdout.write(
      "Could not open a browser automatically. Open the URL above manually.\n\n",
    )
  }

  const result = await waitForCallback

  if (!result) {
    throw new OAuthFlowError(
      "OAuth callback timed out. Re-run with --manual, or try again.",
    )
  }

  assertOAuthState(result.state, session.state)

  return {
    code: result.code,
    verifier: session.verifier,
  }
}

async function login(manual: boolean, timeoutMs: number): Promise<number> {
  const store = new AuthStore()
  const session = createLoginSession()
  const authorization = manual
    ? await authorizeManually(session)
    : await authorizeInBrowser(session, timeoutMs)

  const token = await exchangeAuthorizationCode(authorization)
  const payload = decodeJwtPayload(token.access)

  if (!payload) {
    throw new OAuthFlowError("Received an invalid access token.")
  }

  const accountId = extractChatGPTAccountId(payload)

  if (!accountId) {
    throw new OAuthFlowError("Failed to extract chatgpt_account_id from token.")
  }

  await store.save({
    type: "oauth",
    access: token.access,
    refresh: token.refresh,
    expires: token.expiresAtMs,
    accountId,
  })

  stdout.write("Login successful. Credentials saved.\n")
  return 0
}

async function status(): Promise<number> {
  const store = new AuthStore()
  const creds = await store.load()
  stdout.write("Logged in: yes\n")
  stdout.write(`Account id: ${creds.accountId}\n`)
  stdout.write(`Expires (UTC): ${formatMs(creds.expires)}\n`)
  return 0
}

async function logout(): Promise<number> {
  const store = new AuthStore()
  await store.delete()
  stdout.write("Logged out.\n")
  return 0
}

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  try {
    if (argv.length === 0) {
      stdout.write(`${usage()}\n`)
      return 1
    }

    if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) {
      stdout.write(`${VERSION}\n`)
      return 0
    }

    if (argv[0] !== "auth") {
      stdout.write(`${usage()}\n`)
      return 1
    }

    if (argv[1] === "login") {
      const flags = parseLoginArgs(argv.slice(2))
      return await login(flags.manual, flags.timeoutMs)
    }

    if (argv[1] === "status") {
      return await status()
    }

    if (argv[1] === "logout") {
      return await logout()
    }

    stdout.write(`${usage()}\n`)
    return 1
  } catch (error) {
    const message =
      error instanceof OAuthFlowError ||
      error instanceof NotAuthenticatedError ||
      error instanceof TokenRefreshError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error)

    stdout.write(`${message}\n`)
    return 2
  }
}
