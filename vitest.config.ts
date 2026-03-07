import { configDefaults, defineConfig } from "vitest/config"
import pkg from "./package.json" with { type: "json" }

function includeForMode(mode: string): string[] {
  if (mode === "int") {
    return ["tst/**/*.int.test.ts"]
  }

  if (mode === "int-extended") {
    return ["tst/**/*.extended.int.test.ts"]
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

  return ["tst/**/*.int.test.ts", ...configDefaults.exclude]
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
          : 30_000,
    typecheck: {
      enabled: true,
    },
  },
}))
