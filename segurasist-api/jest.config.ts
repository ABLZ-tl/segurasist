import type { Config } from 'jest';

const baseTransform: { [regex: string]: string | [string, Record<string, unknown>] } = {
  '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
};

const moduleNameMapper = {
  '^@common/(.*)$': '<rootDir>/src/common/$1',
  '^@modules/(.*)$': '<rootDir>/src/modules/$1',
  '^@infra/(.*)$': '<rootDir>/src/infra/$1',
  '^@config/(.*)$': '<rootDir>/src/config/$1',
};

const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/unit/**/*.spec.ts'],
      transform: baseTransform,
      moduleNameMapper,
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
      transform: baseTransform,
      moduleNameMapper,
    },
    {
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/e2e/**/*.spec.ts', '<rootDir>/test/e2e/**/*.e2e-spec.ts'],
      // setup.ts NO matchea por testMatch (no termina en .spec.ts/.e2e-spec.ts).
      // Se carga vía setupFiles para inicializar env vars (ver test/e2e/setup.ts).
      setupFiles: ['<rootDir>/test/e2e/setup.ts'],
      transform: baseTransform,
      moduleNameMapper,
    },
    {
      displayName: 'security',
      testMatch: ['<rootDir>/test/security/**/*.spec.ts'],
      transform: baseTransform,
      moduleNameMapper,
    },
  ],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.module.ts', '!src/main.ts'],
  coverageDirectory: 'coverage',
  // H-21 (Sprint 4) — coverage gate baseline. Antes el repo BE corría sin
  // ningún umbral, lo que permitía PRs que bajaran la cobertura sin que CI
  // los frenara. Empezamos en 60/55/60/60 (target Sprint 4) y la dirección
  // técnica ya tiene compromiso de subir a 70/65/70/70 en Sprint 5 (ver
  // sección 10 "decisiones arquitectónicas" del AUDIT_INDEX).
  coverageThreshold: {
    global: {
      lines: 60,
      branches: 55,
      functions: 60,
      statements: 60,
    },
  },
};

export default config;
