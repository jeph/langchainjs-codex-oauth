import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { URL, URLSearchParams } from "node:url";

import { OAuthFlowError, TokenRefreshError } from "../errors.js";
import { asInteger, asString, isRecord } from "../utils/json.js";

export const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const TOKEN_URL = "https://auth.openai.com/oauth/token";
export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const SCOPE = "openid profile email offline_access";
export const OAUTH_PORT = 1455;
export const REDIRECT_URI = `http://localhost:${OAUTH_PORT}/auth/callback`;

export interface TokenResponse {
  access: string;
  refresh: string;
  expiresAtMs: number;
}

export interface PkceCodes {
  verifier: string;
  challenge: string;
}

function base64Url(input: Uint8Array): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

export function generatePkce(): PkceCodes {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(
    createHash("sha256").update(verifier, "ascii").digest(),
  );

  return {
    verifier,
    challenge,
  };
}

export function createState(): string {
  return randomBytes(16).toString("hex");
}

export function buildAuthorizeUrl(input: {
  state: string;
  codeChallenge: string;
  redirectUri?: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: input.redirectUri ?? REDIRECT_URI,
    scope: SCOPE,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    state: input.state,
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "codex_cli_rs",
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export function decodeJwtPayload(
  token: string,
): Record<string, unknown> | undefined {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return undefined;
  }

  try {
    const payload = Buffer.from(parts[1]!, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(payload);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function extractChatGPTAccountId(
  payload: Record<string, unknown>,
): string | undefined {
  const claim = payload["https://api.openai.com/auth"];

  if (!isRecord(claim)) {
    return undefined;
  }

  return asString(claim.chatgpt_account_id);
}

async function parseTokenResponse(
  response: Response,
  errorType: typeof OAuthFlowError | typeof TokenRefreshError,
): Promise<TokenResponse> {
  let body: unknown;

  try {
    body = await response.json();
  } catch (error) {
    throw new errorType("Token response was not valid JSON.", {
      cause: error,
    });
  }

  if (!isRecord(body)) {
    throw new errorType("Token response was invalid.");
  }

  const access = asString(body.access_token) ?? "";
  const refresh = asString(body.refresh_token) ?? "";
  const expiresIn = asInteger(body.expires_in) ?? 0;

  if (!access || !refresh || !expiresIn) {
    throw new errorType("Token response missing fields.");
  }

  return {
    access,
    refresh,
    expiresAtMs: Date.now() + expiresIn * 1000,
  };
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  verifier: string;
  fetchFn?: typeof fetch;
  redirectUri?: string;
}): Promise<TokenResponse> {
  const fetchFn = input.fetchFn ?? fetch;

  let response: Response;

  try {
    response = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code: input.code,
        code_verifier: input.verifier,
        redirect_uri: input.redirectUri ?? REDIRECT_URI,
      }),
    });
  } catch (error) {
    throw new OAuthFlowError("Authorization code exchange failed.", {
      cause: error,
    });
  }

  if (!response.ok) {
    throw new OAuthFlowError(
      `Authorization code exchange failed (HTTP ${response.status}).`,
    );
  }

  return parseTokenResponse(response, OAuthFlowError);
}

export async function refreshAccessToken(input: {
  refreshToken: string;
  fetchFn?: typeof fetch;
}): Promise<TokenResponse> {
  const fetchFn = input.fetchFn ?? fetch;

  let response: Response;

  try {
    response = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: input.refreshToken,
      }),
    });
  } catch (error) {
    throw new TokenRefreshError("Token refresh failed.", {
      cause: error,
    });
  }

  if (!response.ok) {
    throw new TokenRefreshError(
      `Token refresh failed (HTTP ${response.status}).`,
    );
  }

  return parseTokenResponse(response, TokenRefreshError);
}

const SUCCESS_HTML =
  "<html><body><h3>Login complete.</h3>You can close this tab.</body></html>";

function errorHtml(message: string): string {
  return `<html><body><h3>Authorization failed.</h3><pre>${message}</pre></body></html>`;
}

function readCallbackParams(req: IncomingMessage): {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
} {
  const url = new URL(req.url ?? "", REDIRECT_URI);

  return {
    code: asString(url.searchParams.get("code")),
    state: asString(url.searchParams.get("state")),
    error: asString(url.searchParams.get("error")),
    errorDescription: asString(url.searchParams.get("error_description")),
  };
}

function writeHtml(
  res: ServerResponse<IncomingMessage>,
  status: number,
  html: string,
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

export async function runLocalCallbackServer(
  timeoutMs = 180_000,
): Promise<{ code: string; state?: string } | undefined> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      if (server?.listening) {
        server.close(callback);
        return;
      }

      callback();
    };

    const timer = setTimeout(() => {
      settle(() => resolve(undefined));
    }, timeoutMs);

    const finish = (value: { code: string; state?: string }): void => {
      settle(() => resolve(value));
    };

    const fail = (message: string, cause?: unknown): void => {
      settle(() => reject(new OAuthFlowError(message, { cause })));
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "", REDIRECT_URI);

      if (url.pathname !== "/auth/callback") {
        res.statusCode = 404;
        res.end();
        return;
      }

      const params = readCallbackParams(req);

      if (params.error) {
        const message = params.errorDescription ?? params.error;
        writeHtml(res, 400, errorHtml(message));
        fail(`OAuth callback failed: ${message}`);
        return;
      }

      if (!params.code) {
        writeHtml(res, 400, errorHtml("Missing authorization code."));
        fail("OAuth callback did not include an authorization code.");
        return;
      }

      writeHtml(res, 200, SUCCESS_HTML);
      finish({ code: params.code, state: params.state });
    });

    server.on("error", (error) => {
      const message =
        isRecord(error) && asString(error.code) === "EADDRINUSE"
          ? `Port ${OAUTH_PORT} is unavailable. Re-run with --manual or close other Codex sessions.`
          : "Failed to start the OAuth callback server.";

      fail(message, error);
    });

    server.listen(OAUTH_PORT, "127.0.0.1");
  });
}

export function parseAuthorizationInput(value: string): {
  code?: string;
  state?: string;
} {
  const text = value.trim();

  if (!text) {
    return {};
  }

  try {
    const url = new URL(text);
    return {
      code: asString(url.searchParams.get("code")),
      state: asString(url.searchParams.get("state")),
    };
  } catch {
    // Fall through.
  }

  if (text.includes("code=")) {
    const params = new URLSearchParams(text);
    return {
      code: asString(params.get("code")),
      state: asString(params.get("state")),
    };
  }

  if (text.includes("#")) {
    const [code, state] = text.split("#", 2);
    return {
      code: code || undefined,
      state: state || undefined,
    };
  }

  return {
    code: text,
  };
}

export async function openInBrowser(url: string): Promise<boolean> {
  const commands: Array<{ file: string; args: string[] }> =
    process.platform === "darwin"
      ? [{ file: "open", args: [url] }]
      : process.platform === "win32"
        ? [{ file: "cmd", args: ["/c", "start", "", url] }]
        : [{ file: "xdg-open", args: [url] }];

  for (const command of commands) {
    const opened = await new Promise<boolean>((resolve) => {
      const child = spawn(command.file, command.args, {
        detached: true,
        stdio: "ignore",
      });

      child.on("error", () => resolve(false));
      child.on("spawn", () => {
        child.unref();
        resolve(true);
      });
    });

    if (opened) {
      return true;
    }
  }

  return false;
}
