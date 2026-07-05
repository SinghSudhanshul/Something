/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        // Services
        'auth',
        'bazaar',
        'wallet',
        'feast',
        'rides',
        'swift',
        'skills',
        'pulse',
        'trust',
        'notifications',
        'search',
        'analytics',
        'user',
        // Apps
        'mobile',
        'web',
        'admin',
        // Packages
        'types',
        'kafka',
        'database',
        'utils',
        // Infrastructure
        'infra',
        'ci',
        'deps',
        'global',
      ],
    ],
    'scope-empty': [2, 'never'],
    'subject-case': [2, 'always', 'lower-case'],
    'subject-empty': [2, 'never'],
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'],
    ],
  },
};
