// Scoped settings checks; no PostgreSQL, native runtime or browser services.
export default {
  test: {
    include: ["apps/web/src/features/settings/*.test.ts"],
    testTimeout: 10000,
    fileParallelism: false,
    maxWorkers: 1,
  },
};
