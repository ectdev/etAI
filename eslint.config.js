import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', 'corpus/**'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Unused arguments are often meaningful in handler signatures, so allow
      // them when they are explicitly marked with a leading underscore.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      /**
       * `.pathname` on a file URL is a path only by coincidence.
       *
       * It does not decode percent-encoding, so a clone into a directory with a space in
       * its name yields `/Users/me/My%20Projects/...` and every fs call on it returns
       * ENOENT. On Windows it is worse: the value starts `/C:/`, which is not a path at
       * all. Five test files here did this, and all five would have failed for anyone
       * who cloned somewhere ordinary.
       *
       * `fileURLToPath()` handles both. Passing the URL object straight to `readFileSync`
       * is also fine, since fs decodes it itself, so this only forbids the string form.
       *
       * Matched through `:has(MetaProperty)`, so it fires on a URL built from
       * `import.meta.url` and leaves `request.nextUrl.pathname` in the proxy alone.
       * On an HTTP URL `.pathname` is the right call, and a rule that needs a disable
       * comment on correct code teaches people to add disable comments.
       */
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='pathname']:has(MetaProperty)",
          message:
            'Use fileURLToPath(url) rather than url.pathname: .pathname keeps percent-encoding, so a clone into a path with a space breaks, and on Windows it starts with a drive letter.',
        },
      ],
    },
  },
  {
    /**
     * Schemas are built from the configured Zod in `@etai/shared`, never from `zod` itself.
     *
     * That module turns off the compiled parser before any schema exists, which is what
     * keeps the browser from reporting an `eval` violation on every page. A schema built
     * from a bare `zod` import elsewhere would quietly bring the report back. Types and
     * `ZodError` are fine to import directly; only `z` builds schemas.
     */
    files: ['packages/**/*.ts', 'apps/**/*.{ts,tsx}'],
    ignores: ['packages/shared/src/zod.ts', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'zod',
              importNames: ['z', 'default'],
              message:
                "Build schemas with the configured z from @etai/shared's zod.ts, which keeps Zod's eval probe off under the page CSP.",
            },
          ],
        },
      ],
    },
  },
);
