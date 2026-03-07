export function getEnvironmentVariable(name: string): string | undefined {
  const value = process.env[name]
  return typeof value === "string" && value.length > 0 ? value : undefined
}
