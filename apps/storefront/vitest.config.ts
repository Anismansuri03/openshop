import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  esbuild: {
    // Next.js components rely on the automatic JSX runtime (they do not
    // import React in every file); without this, render-based tests hit
    // "React is not defined" when transforming imported .tsx files.
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@lib": path.resolve(__dirname, "src/lib"),
      "@modules": path.resolve(__dirname, "src/modules"),
      "@pages": path.resolve(__dirname, "src/app"),
      "@components": path.resolve(__dirname, "src/components"),
    },
  },
})
