export class CodexOAuthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class OAuthFlowError extends CodexOAuthError {}

export class TokenRefreshError extends CodexOAuthError {}

export class NotAuthenticatedError extends CodexOAuthError {}

export class CodexAPIError extends CodexOAuthError {
  readonly statusCode?: number;

  constructor(
    message: string,
    options?: { cause?: unknown; statusCode?: number },
  ) {
    super(message, options);
    this.statusCode = options?.statusCode;
  }
}
