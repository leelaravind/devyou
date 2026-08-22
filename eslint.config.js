import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * DevYou lint policy — one flat config for the whole monorepo.
 *
 * Rules that protect an invariant are errors, never warnings. A warning in CI is a
 * rule nobody enforces.
 *
 * The `no-restricted-syntax` block below is where the product's non-negotiables get
 * mechanical teeth. Prose in CLAUDE.md is a reminder; these are enforcement.
 */
export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.turbo/**",
      "**/.wrangler/**",
      "**/.react-router/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/worker-configuration.d.ts",
      "docs/**",
      "tests/fixtures/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "no-restricted-syntax": [
        "error",
        {
          /*
            Invariant 10: all user content is hostile.

            Markdown, code blocks, AI output and pasted stack traces all reach the
            renderer. There is no case in this product where injecting them as HTML is
            correct, so the escape hatch is closed rather than documented.
          */
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message:
            "dangerouslySetInnerHTML is forbidden: playbook content, code and AI output are untrusted. Use the sanitising renderer in @devyou/security.",
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: "Use crypto.getRandomValues / crypto.randomUUID for anything security-relevant.",
        },
        {
          /*
            Invariant 6: no arbitrary code execution in V1.

            Commands in a playbook are inert content. `eval` and `new Function` have no
            legitimate use here, and a diagnostic-step evaluator is exactly the kind of
            feature that would reach for one.
          */
          selector:
            "CallExpression[callee.name='eval'], NewExpression[callee.name='Function'], CallExpression[callee.name='Function']",
          message: "No dynamic code evaluation. Playbook commands are inert content — ADR-0007.",
        },
      ],
    },
  },
  {
    /*
      Invariant 1: verification is derived from evidence, never stored as a flag.

      Scoped to the layers where such a field would actually *be* a flag — the
      schema, the domain rules, the wire contracts and the persistence layer. It
      was global for about ten minutes, and it immediately fired on the icon named
      `verified` in the design system: a Material Symbols glyph, not a truth claim.

      Narrowing it is not a weakening. A `verified` column can only be introduced in
      these four packages, and a lint rule that cries wolf on a glyph name is a rule
      somebody disables.
    */
    files: [
      "packages/db/**/*.ts",
      "packages/domain/**/*.ts",
      "packages/schemas/**/*.ts",
      "packages/search/**/*.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Property[key.name=/^(verified|isVerified|is_verified)$/], PropertyDefinition[key.name=/^(verified|isVerified|is_verified)$/], TSPropertySignature[key.name=/^(verified|isVerified|is_verified)$/]",
          message:
            "No `verified` flag. Confidence is derived from typed evidence records at read time — ADR-0006.",
        },
      ],
    },
  },
  {
    // Worker runtime globals come from the generated Cloudflare types.
    files: ["apps/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        Env: "readonly",
        ExecutionContext: "readonly",
        ExportedHandler: "readonly",
        MessageBatch: "readonly",
        Cloudflare: "readonly",
      },
    },
  },
  {
    files: ["**/*.{tsx,jsx}", "packages/ui/**/*.ts"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    // Specs, build configuration and operational scripts: console output is the
    // interface, not a leftover debug statement.
    files: [
      "tests/**/*.{ts,tsx}",
      "**/test/**/*.{ts,tsx}",
      "**/*.test.{ts,tsx}",
      "scripts/**/*.{js,mjs,ts}",
      "**/*.config.{js,ts,mts}",
    ],
    rules: { "no-console": "off" },
  },
  {
    // Fixtures deliberately contain hostile strings: XSS payloads, bidi controls,
    // prompt-injection attempts. They are data, not code to be linted for style.
    files: ["**/*.d.ts"],
    rules: { "@typescript-eslint/no-namespace": "off" },
  },
];
