export function getEnvironmentVariable(name: string): string | undefined {
  const value = process.env[name]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function getIntegerEnvironmentVariable(
  name: string,
): number | undefined {
  const value = getEnvironmentVariable(name)

  if (!value) {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : undefined
}

export function getFloatEnvironmentVariable(name: string): number | undefined {
  const value = getEnvironmentVariable(name)

  if (!value) {
    return undefined
  }

  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
