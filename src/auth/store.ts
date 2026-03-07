import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { getEnvironmentVariable } from "@langchain/core/utils/env";

import { CodexOAuthError, NotAuthenticatedError } from "../errors.js";
import { asInteger, asString, isRecord } from "../utils/json.js";

export interface OAuthCredentials {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
}

export const HOME_ENV = "LANGCHAINJS_CODEX_OAUTH_HOME";
export const AUTH_PATH_ENV = "LANGCHAINJS_CODEX_OAUTH_AUTH_PATH";

export function expandHome(value: string): string {
  return value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value;
}

export function defaultHomeDir(): string {
  const envHome = getEnvironmentVariable(HOME_ENV);
  return envHome
    ? expandHome(envHome)
    : path.join(homedir(), ".langchainjs-codex-oauth");
}

export function defaultAuthPath(): string {
  const envPath = getEnvironmentVariable(AUTH_PATH_ENV);
  return envPath
    ? expandHome(envPath)
    : path.join(defaultHomeDir(), "auth", "openai.json");
}

function authHint(): string {
  return "Not authenticated. Run `npx langchainjs-codex-oauth auth login`.";
}

function fromObject(data: Record<string, unknown>): OAuthCredentials {
  const access = asString(data.access) ?? "";
  const refresh = asString(data.refresh) ?? "";
  const accountId = asString(data.account_id) ?? asString(data.accountId) ?? "";
  const expires = asInteger(data.expires) ?? 0;

  return {
    type: "oauth",
    access,
    refresh,
    expires,
    accountId,
  };
}

function toObject(creds: OAuthCredentials): Record<string, unknown> {
  return {
    type: creds.type,
    access: creds.access,
    refresh: creds.refresh,
    expires: creds.expires,
    account_id: creds.accountId,
  };
}

export class AuthStore {
  readonly authPath: string;

  constructor(authPath?: string) {
    this.authPath = authPath ? expandHome(authPath) : defaultAuthPath();
  }

  async load(): Promise<OAuthCredentials> {
    let raw: string;

    try {
      raw = await readFile(this.authPath, "utf8");
    } catch {
      throw new NotAuthenticatedError(authHint());
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new NotAuthenticatedError(
        `Auth file is invalid at ${this.authPath}. Run \`npx langchainjs-codex-oauth auth login\`.`,
      );
    }

    if (!isRecord(parsed)) {
      throw new NotAuthenticatedError(
        `Auth file is invalid at ${this.authPath}. Run \`npx langchainjs-codex-oauth auth login\`.`,
      );
    }

    const creds = fromObject(parsed);

    if (!creds.access || !creds.refresh || !creds.accountId || !creds.expires) {
      throw new NotAuthenticatedError(
        `Auth file is incomplete at ${this.authPath}. Run \`npx langchainjs-codex-oauth auth login\`.`,
      );
    }

    return creds;
  }

  async save(creds: OAuthCredentials): Promise<void> {
    const authDir = path.dirname(this.authPath);
    const tmpPath = `${this.authPath}.${randomUUID()}.tmp`;
    const content = `${JSON.stringify(toObject(creds), null, 2)}\n`;

    await mkdir(authDir, {
      recursive: true,
      ...(process.platform === "win32" ? {} : { mode: 0o700 }),
    });

    try {
      if (process.platform === "win32") {
        await writeFile(tmpPath, content, "utf8");
      } else {
        const handle = await open(tmpPath, "wx", 0o600);

        try {
          await handle.writeFile(content, "utf8");
        } finally {
          await handle.close();
        }
      }

      await rename(tmpPath, this.authPath);
    } catch (error) {
      await unlink(tmpPath).catch(() => {
        // Ignore temp file cleanup failures.
      });
      throw error;
    }

    if (process.platform === "win32") {
      return;
    }

    try {
      await chmod(this.authPath, 0o600);
      const authStat = await stat(this.authPath);

      if ((authStat.mode & 0o077) !== 0) {
        throw new CodexOAuthError(
          `Auth file permissions are too open at ${this.authPath}. Refusing to keep credentials on disk.`,
        );
      }
    } catch (error) {
      await unlink(this.authPath).catch(() => {
        // Ignore cleanup failures.
      });

      if (error instanceof CodexOAuthError) {
        throw error;
      }

      throw new CodexOAuthError(
        `Unable to secure auth file permissions at ${this.authPath}.`,
        { cause: error },
      );
    }
  }

  async delete(): Promise<void> {
    try {
      await unlink(this.authPath);
    } catch {
      // Ignore missing files.
    }
  }
}
