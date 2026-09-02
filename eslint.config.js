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
       * all. Five test files here did this, and all five would have failed for a reviewer
       * who cloned somewhere ordinary.
       *
       * `fileURLToPath()` handles both. Passing the URL object straight to `readFileSync`
       * is also fine, since fs decodes it itself, so this only forbids the string form.
       *
       * Matched through `:has(MetaProperty)`, so it fires on a URL built from
       * `import.meta.url` and leaves `request.nextUrl.pathname` in the middleware alone.
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
);
