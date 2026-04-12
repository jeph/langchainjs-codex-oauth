import { readFileSync } from "node:fs"

import { configDefaults, defineConfig } from "vitest/config"

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string }

function includeForMode(mode: string): string[] {
  if (mode === "int") {
    return ["tst/**/*.int.test.ts"]
  }

  if (mode === "int-extended") {
    return ["tst/**/*.extended.int.test.ts"]
  }

  if (mode === "e2e") {
    return ["tst/**/*.e2e.test.ts"]
  }

  return ["tst/**/*.test.ts"]
}

function excludeForMode(mode: string): string[] {
  if (mode === "int") {
    return ["tst/**/*.extended.int.test.ts", ...configDefaults.exclude]
  }

  if (mode === "int-extended") {
    return configDefaults.exclude
  }

  if (mode === "e2e") {
    return configDefaults.exclude
  }

  return [
    "tst/**/*.int.test.ts",
    "tst/**/*.e2e.test.ts",
    ...configDefaults.exclude,
  ]
}

export default defineConfig((env) => ({
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: "node",
    exclude: excludeForMode(env.mode),
    include: includeForMode(env.mode),
    hideSkippedTests: true,
    testTimeout:
      env.mode === "int-extended"
        ? 300_000
        : env.mode === "int"
          ? 120_000
          : env.mode === "e2e"
            ? 120_000
            : 30_000,
    typecheck: {
      enabled: true,
    },
  },
}))
