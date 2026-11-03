import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    // Test-only SSRF policy: lets the engine reach the local fixture site on 127.0.0.1.
    env: { WEBAUDIT_TEST_ALLOW_LOOPBACK: "1" },
  },
});
