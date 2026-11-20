module.exports = {
  root: true,
  env: { browser: true, es2022: true, worker: true },
  parser: '@typescript-eslint/parser',
  plugins: ['react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['/dist/', 'node_modules/', '/public/', '/ios/', '/android/'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-empty': ['error', { allowEmptyCatch: true }],
    'react-hooks/rules-of-hooks': 'error',
  },
};
