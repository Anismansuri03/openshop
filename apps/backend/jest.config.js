const { loadEnv } = require("@medusajs/utils");
loadEnv("test", process.cwd());

module.exports = {
  transform: {
    "^.+\\.[jt]s$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", decorators: true },
        },
      },
    ],
  },
  testEnvironment: "node",
  moduleFileExtensions: ["js", "ts", "json"],
  modulePathIgnorePatterns: ["dist/", "<rootDir>/.medusa/"],
  setupFiles: ["./integration-tests/setup.js"],
  // Integration suites boot a full Medusa app (modules + search indexes +
  // HTTP server) inside the runner's beforeAll hook. The default 5s hook
  // timeout aborts the boot, leaving the container null. Allow a generous
  // ceiling so the disposable database can be created, migrated, and booted.
  hookTimeout: 300000,
  testTimeout: 180000,
};

if (process.env.TEST_TYPE === "integration:http") {
  module.exports.testMatch = ["**/integration-tests/http/*.spec.[jt]s"];
} else if (process.env.TEST_TYPE === "integration:modules") {
  module.exports.testMatch = ["**/src/modules/*/__tests__/**/*.[jt]s"];
} else if (process.env.TEST_TYPE === "integration:migrate") {
  // DB-backed: spawns the medusa CLI against a disposable database to prove
  // `db:migrate` exit codes (checked wrapper). Needs PostgreSQL.
  module.exports.testMatch = ["**/integration-tests/migrate/*.spec.[jt]s"];
} else if (process.env.TEST_TYPE === "unit") {
  module.exports.testMatch = ["**/src/**/__tests__/**/*.unit.spec.[jt]s"];
}
