// Lighthouse CI budgets — portal asegurado (spec §9). Stricter than admin
// because the experience is mobile-first and accessibility-critical.
module.exports = {
  ci: {
    collect: {
      url: ['http://localhost:3001/'],
      startServerCommand: 'pnpm --filter @segurasist/portal start',
      startServerReadyPattern: 'ready',
      numberOfRuns: 3,
      settings: { preset: 'mobile' },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['warn', { minScore: 0.9 }],
        'categories:seo': ['warn', { minScore: 0.9 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2000 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }],
        'total-blocking-time': ['error', { maxNumericValue: 200 }],
      },
    },
    upload: { target: 'temporary-public-storage' },
  },
};
