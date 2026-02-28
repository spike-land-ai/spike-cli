import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
});
