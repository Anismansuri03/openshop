#!/usr/bin/env node
/**
 * Cross-platform jest launcher.
 *
 * The previous scripts encoded POSIX inline env assignment
 * (`TEST_TYPE=unit NODE_OPTIONS=... jest ...`), which cannot run on Windows
 * shells — `pnpm run test:unit` failed there before ever reaching jest.
 * Setting the variables here and spawning jest with process.execPath works
 * on every platform and needs no extra dependency.
 *
 * Usage: node scripts/run-jest.js <unit|integration:http|integration:modules> [...jest args]
 */
const { spawnSync } = require("child_process")
const path = require("path")

const TEST_TYPES = [
  "unit",
  "integration:http",
  "integration:modules",
  "integration:migrate",
]
const testType = process.argv[2] || "unit"

if (!TEST_TYPES.includes(testType)) {
  console.error(
    `Unknown test type "${testType}". Expected one of: ${TEST_TYPES.join(", ")}`
  )
  process.exit(2)
}

const jestEntry = path.join(
  path.dirname(require.resolve("jest/package.json")),
  "bin",
  "jest.js"
)

const isUnit = testType === "unit"
const defaultArgs = isUnit ? ["--silent"] : ["--silent=false"]
const extraArgs = process.argv.slice(3)

// A caller-supplied flag (e.g. --silent=false) must win over the default.
const usesDefault =
  extraArgs.length === 0 ||
  !extraArgs.some((arg) => arg.startsWith("--silent"))

const args = [
  jestEntry,
  ...(usesDefault ? defaultArgs : []),
  ...extraArgs,
  "--runInBand",
  "--forceExit",
]

process.env.TEST_TYPE = testType
const nodeOptions = [process.env.NODE_OPTIONS, "--experimental-vm-modules"]
  .filter(Boolean)
  .join(" ")
process.env.NODE_OPTIONS = nodeOptions

const result = spawnSync(process.execPath, args, { stdio: "inherit" })

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status === null ? 1 : result.status)
