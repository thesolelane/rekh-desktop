// ESLint flat config for REKH. Goal: catch real bugs + cap file/function size —
// WITHOUT fighting the intentionally compact one-liner style (no stylistic nags).
const globals = require('globals');

const rules = {
  // --- correctness (real bugs) — errors ---
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-unreachable': 'error',
  'no-const-assign': 'error',
  'no-func-assign': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  'no-fallthrough': 'error',
  'valid-typeof': 'error',
  'use-isnan': 'error',
  'no-self-assign': 'error',
  'no-self-compare': 'warn',
  'no-constant-condition': ['warn', { checkLoops: false }],
  'no-empty': ['warn', { allowEmptyCatch: true }], // catch(e){} is used deliberately
  // eqeqeq intentionally OFF — the codebase uses ==/!= in one-liners on purpose.

  // --- size & complexity caps — the "stop large files / big blocks" goal ---
  'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': ['warn', { max: 90, skipBlankLines: true, skipComments: true, IIFEs: true }],
  'complexity': ['warn', 16],
  'max-depth': ['warn', 5],
  'max-params': ['warn', 6],
  'max-nested-callbacks': ['warn', 4],
};

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'build/**', '_*.js', 'eslint.config.js'] },
  {
    // Main process + preload run in Node (CommonJS).
    files: ['main.js', 'preload.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules,
  },
  {
    // Renderer main script. Uses the panel functions defined in ui-panels.js
    // (classic scripts share one global scope; ui-panels.js loads after this).
    files: ['renderer/newtab.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, rekhAPI: 'readonly', renderSettings: 'readonly', renderVault: 'readonly', renderKnowledge: 'readonly', renderTools: 'readonly', renderShare: 'readonly', extractMedia: 'readonly', closeUtility: 'readonly' },
    },
    rules,
  },
  {
    // Extracted panels. Uses shared UI state/helpers defined in newtab.js.
    files: ['renderer/ui-panels.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        ...globals.browser, rekhAPI: 'readonly',
        utilList: 'readonly', utilTitle: 'readonly', utilSidebar: 'readonly', utilClose: 'readonly',
        overlay: 'readonly', utilOpen: 'writable', showToast: 'readonly', createTab: 'readonly',
        privacyState: 'writable', aiKeyStatus: 'writable', updateVpnIndicator: 'readonly',
        getActiveTab: 'readonly', aiThread: 'readonly', aiAddBubble: 'readonly',
      },
    },
    rules,
  },
];
