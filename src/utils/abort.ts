export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return
  }

  if (signal.reason instanceof Error) {
    throw signal.reason
  }

  throw new Error("Request aborted.")
}
