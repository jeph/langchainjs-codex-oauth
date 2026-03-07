import { defineConfig } from "tsdown";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["./src/index.ts", "./src/bin.ts"],
  format: ["esm", "cjs"],
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
});
