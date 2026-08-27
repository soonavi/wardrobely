/**
 * ESLint configuration for the Selv app (flat config, ESLint 9).
 *
 * Built on `eslint-config-expo`, the config Expo maintains for exactly this
 * stack (Expo SDK 54, React Native 0.81, React 19, TypeScript 5.9).
 *
 * Version pinning, because neither number is arbitrary:
 *   - eslint-config-expo is pinned to ~10.0.0. The package tracks SDK
 *     releases, and 10.0.0 was published in the same minute as
 *     expo@54.0.0-preview.0; the SDK-aligned renumbering (55.x = SDK 55)
 *     only began afterwards, so 10.0.0 *is* the SDK 54 release.
 *   - ESLint is pinned to the 9.x line, not 10.x. Every plugin that
 *     eslint-config-expo@10 bundles — eslint-plugin-import,
 *     eslint-plugin-react, eslint-plugin-react-hooks, @typescript-eslint —
 *     declares an eslint peer range that stops at ^9. Moving to ESLint 10
 *     means running four plugins outside their supported range.
 *
 * `eslint-config-expo/flat` is the flat-config entry point. The package's
 * bare `main` is the legacy .eslintrc shape and must not be used here.
 */
const expoConfig = require('eslint-config-expo/flat');
const { defineConfig, globalIgnores } = require('eslint/config');

module.exports = defineConfig([
  globalIgnores([
    // Third-party code: not ours to lint, and enormous.
    'node_modules/',

    // Expo's local build/cache scratch directory — generated, not authored.
    // Gitignored, and excluded by tsconfig.json.
    '.expo/',

    // `expo export` output: bundled, minified copies of src/. Linting it
    // would report every finding twice — once at the source, once at the
    // build artifact. Gitignored, and excluded by tsconfig.json.
    'dist/',

    // Supabase Deno edge functions. These are not Node or React Native
    // modules: they import straight from `https://` URLs and use Deno
    // globals (`Deno.env`, `Deno.serve`). ESLint can resolve neither, so
    // eslint-plugin-import would flag every remote import as unresolved and
    // no-undef would flag every Deno global. They are typechecked and run by
    // the Deno toolchain via supabase/functions/deno.json instead. Both
    // tsconfig.json and jest.config.js already exclude this directory for
    // exactly this reason; ESLint excludes it for consistency.
    'supabase/functions/',
  ]),

  expoConfig,

  {
    // ---- React rules relaxed project-wide -------------------------------
    // Both assume a DOM that a React Native app does not have. Neither is
    // switched off to hide a real finding.
    rules: {
      // Validates JSX props against the list of known *DOM* properties.
      // There is no DOM here. Host elements are React Native components
      // (<View>, <Text>) and, on the 3D screens, react-three-fiber
      // intrinsics (<mesh>, <meshStandardMaterial>) whose props are three.js
      // object paths like `shadow-camera-left` and `vertexColors`. The rule
      // produced 62 reports across the codebase and every one was a false
      // positive; it has no valid application in a React Native project.
      'react/no-unknown-property': 'off',

      // Flags raw ' and " in JSX text, because in *HTML* they can be
      // mistyped entities. React Native renders <Text> children as literal
      // strings with no entity decoding, so "fixing" a string to &apos;
      // makes the device display the characters &apos; verbatim. Complying
      // with this rule would introduce display bugs — see the imperial
      // height hint in ProfileScreen (`5'8" = 68`).
      'react/no-unescaped-entities': 'off',
    },
  },

  {
    // ---- TypeScript rules relaxed ---------------------------------------
    // Scoped to the files eslint-config-expo registers the @typescript-eslint
    // plugin for. An unscoped block would try to apply these rule names to
    // plain .js files, where the plugin is not in scope, and ESLint fails
    // outright rather than ignoring them.
    files: ['**/*.ts', '**/*.tsx', '**/*.d.ts'],
    rules: {
      // Pure formatting preference between `ReadonlyArray<T>` and
      // `readonly T[]`. Both are idiomatic TypeScript and mean the same
      // thing; the rule carries no correctness signal.
      '@typescript-eslint/array-type': 'off',

      // Narrowed rather than disabled. `interface X extends Y {}` is the
      // canonical TypeScript declaration-merging idiom, used in
      // src/types/three-jsx.d.ts to inject react-three-fiber's
      // ThreeElements into the JSX namespace — the emptiness is the point.
      // Genuinely empty `{}` types are still reported.
      '@typescript-eslint/no-empty-object-type': [
        'warn',
        { allowInterfaces: 'with-single-extends' },
      ],
    },
  },

  {
    // Repo tooling that runs in Node under CommonJS rather than in the app
    // bundle: metro/babel/jest config, plus this file. Without Node globals
    // declared, `module`, `require` and `__dirname` all read as undefined.
    files: ['*.config.js', 'eslint.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'writable',
        require: 'readonly',
        process: 'readonly',
      },
    },
  },

  {
    // Jest injects its globals rather than having them imported, so without
    // this every describe/it/expect reads as an undefined variable.
    files: ['**/__tests__/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        afterAll: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        jest: 'readonly',
        test: 'readonly',
      },
    },
    rules: {
      // `jest.mock()` is hoisted above imports by babel-plugin-jest-hoist,
      // so a mock that must run before a module loads is conventionally
      // written directly above that module's import, where a reader can see
      // what it replaces. import/first cannot model that hoisting and
      // reports the arrangement as an error. Scoped to tests only, so the
      // rule keeps its signal in application code.
      'import/first': 'off',
    },
  },
]);
