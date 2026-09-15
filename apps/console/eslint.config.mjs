import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import oxlint from 'eslint-plugin-oxlint';

const config = [...nextCoreWebVitals, ...nextTypescript];

const platformBoundaryPatterns = [
  '@arsvine/authz',
  '@arsvine/authz/**',
  '@arsvine/core-db',
  '@arsvine/core-db/**',
  '@arsvine/object-storage',
  '@arsvine/object-storage/**',
  '@arsvine/observability',
  '@arsvine/observability/**',
  '**/packages/authz/**',
  '**/packages/contracts/**',
  '**/packages/core-db/**',
  '**/packages/object-storage/**',
  '**/packages/observability/**',
];

const compatibilityConfig = oxlint.buildFromOxlintConfigFile('../../config/oxlint.json');

const platformEslintConfig = [
  ...config,
  ...compatibilityConfig,
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: platformBoundaryPatterns,
              message:
                'Console must use its application boundary; server implementations belong to their owning platform package.',
            },
          ],
        },
      ],
    },
  },
];

export default platformEslintConfig;
