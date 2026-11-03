import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    // Test-only SSRF policy so the app may audit the local fixture site on 127.0.0.1.
    env: { WEBAUDIT_TEST_ALLOW_LOOPBACK: "1" },
  },
});
