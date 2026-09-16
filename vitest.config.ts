import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // 与 wxt 的 srcDir 别名保持一致
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    // highlighter 依赖 TreeWalker / getComputedStyle 等真实 DOM 语义
    environment: 'jsdom',
    include: ['utils/**/*.test.ts', 'entrypoints/**/*.test.ts'],
  },
});
