import { defineConfig } from "vitest/config";

// 根测试只覆盖 scripts/（红线扫描器自身的测试）；
// 各包测试由 `pnpm -F <pkg> test`（包内 vitest.config.ts）运行。
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts"],
    passWithNoTests: true,
  },
});
