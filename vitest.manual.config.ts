import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["scripts/manual/**/*.manual.test.ts"],
    testTimeout: 60000,
  },
});

