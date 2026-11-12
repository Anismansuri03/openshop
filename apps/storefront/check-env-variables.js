const c = require("ansi-colors");

const requiredEnvs = [
  {
    key: "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY",
    // TODO: we need a good doc to point this to
    description:
      "Learn how to create a publishable key: https://docs.medusajs.com/v2/resources/storefront-development/publishable-api-keys",
  },
  {
    key: "NEXT_PUBLIC_MEDUSA_BACKEND_URL",
    description:
      "URL of the Medusa backend, e.g. http://localhost:9000 (see .env.template)",
  },
];

// Format checks run only for variables that are present, so the failure
// message distinguishes "unset" from "set but malformed" (a pasted key with
// quotes or whitespace is the common case).
const formatChecks = [
  {
    key: "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY",
    test: /^pk_[A-Za-z0-9_-]+$/,
    hint: 'must look like pk_... (no quotes or surrounding whitespace)',
  },
  {
    key: "NEXT_PUBLIC_MEDUSA_BACKEND_URL",
    test: /^https?:\/\/[^\s]+$/,
    hint: "must be an http(s):// URL without spaces",
  },
];

function checkEnvVariables() {
  const missingEnvs = requiredEnvs.filter(function (env) {
    c;
    return !process.env[env.key];
  });

  if (missingEnvs.length > 0) {
    console.error(
      c.red.bold("\nError: Missing required environment variables\n")
    );

    missingEnvs.forEach(function (env) {
      console.error(c.yellow(`  ${c.bold(env.key)}`));
      if (env.description) {
        console.error(c.dim(`    ${env.description}\n`));
      }
    });

    console.error(
      c.yellow(
        "\nPlease set these variables in your .env file or environment before starting the application.\n"
      )
    );

    process.exit(1);
  }

  const malformed = formatChecks.filter(function (check) {
    const value = process.env[check.key];
    return value !== undefined && value !== "" && !check.test.test(value);
  });

  if (malformed.length > 0) {
    console.error(
      c.red.bold("\nError: Invalid environment variable values\n")
    );

    malformed.forEach(function (check) {
      console.error(c.yellow(`  ${c.bold(check.key)} ${c.dim(check.hint)}`));
    });

    console.error(
      c.yellow(
        "\nFix these values in your .env file before starting the application.\n"
      )
    );

    process.exit(1);
  }
}

module.exports = checkEnvVariables;
