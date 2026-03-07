import { configDefaults, defineConfig } from "vitest/config"
import pkg from "./package.json" with { type: "json" }

export default defineConfig((env) => ({
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: "node",
    exclude:
      env.mode === "int"
        ? configDefaults.exclude
        : ["tst/**/*.int.test.ts", ...configDefaults.exclude],
    include:
      env.mode === "int" ? ["tst/**/*.int.test.ts"] : ["tst/**/*.test.ts"],
    hideSkippedTests: true,
    testTimeout: env.mode === "int" ? 120_000 : 30_000,
    typecheck: {
      enabled: true,
    },
  },
}))
