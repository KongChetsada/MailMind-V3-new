import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const config = (await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)).default;
const load = (phase) => typeof config === 'function' ? config(phase) : config;

const withBackend = (value, action) => {
  const previous = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (value === undefined) delete process.env.NEXT_PUBLIC_BACKEND_URL;
  else process.env.NEXT_PUBLIC_BACKEND_URL = value;
  try { action(); } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BACKEND_URL;
    else process.env.NEXT_PUBLIC_BACKEND_URL = previous;
  }
};

for (const value of [undefined, '', 'http://localhost:5000', 'https://api.example.com/api', 'not-a-url']) {
  test(`production build rejects invalid backend URL: ${value}`, () => {
    withBackend(value, () => assert.throws(() => load('phase-production-build'), /NEXT_PUBLIC_BACKEND_URL/));
  });
}

test('production build accepts HTTPS backend origin', () => {
  withBackend('https://api.example.com', () => assert.ok(load('phase-production-build').images));
});

test('development keeps the localhost fallback', () => {
  withBackend(undefined, () => assert.ok(load('phase-development-server').images));
});
