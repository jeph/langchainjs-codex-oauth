import { readFileSync } from "node:fs"

import { defineConfig } from "tsup"

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string }

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["./src/index.ts", "./src/bin.ts"],
  format: ["esm", "cjs"],
  splitting: false,
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
  outExtension({ format }) {
    return {
      js: format === "esm" ? ".mjs" : ".cjs",
    }
  },
})
