const root = await import("langchainjs-codex-oauth")
const auth = await import("langchainjs-codex-oauth/auth")
const client = await import("langchainjs-codex-oauth/client")
const errors = await import("langchainjs-codex-oauth/errors")

if (typeof root.ChatCodexOAuth !== "function") {
  throw new Error("Missing ChatCodexOAuth export.")
}

if (typeof auth.AuthStore !== "function") {
  throw new Error("Missing AuthStore export.")
}

if (typeof client.CodexClient !== "function") {
  throw new Error("Missing CodexClient export.")
}

if (typeof errors.CodexAPIError !== "function") {
  throw new Error("Missing CodexAPIError export.")
}
