const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const productionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  JWT_SECRET: 'j'.repeat(48),
  ENCRYPTION_SECRET: 'e'.repeat(48),
  FRONTEND_URL: 'https://frontend.example.com',
  GOOGLE_CLIENT_ID: 'test-client',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_REDIRECT_URI: 'https://backend.example.com/api/auth/google/callback',
  DEMO_MODE: 'false',
};

const checkEnv = (overrides = {}) => spawnSync(process.execPath, ['-e',
  "require('./src/config/env').assertRequiredEnv()",
], {
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, ...productionEnv, ...overrides },
  encoding: 'utf8',
});

test('production: refuses a missing frontend URL instead of redirecting to localhost', () => {
  const result = checkEnv({ FRONTEND_URL: '' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FRONTEND_URL/);
});

test('production: accepts complete configuration', () => {
  assert.equal(checkEnv().status, 0);
});

for (const [name, value] of [
  ['FRONTEND_URL', 'http://localhost:3000'],
  ['FRONTEND_URL', 'https://frontend.example.com/path'],
  ['GOOGLE_CLIENT_ID', ''],
  ['GOOGLE_CLIENT_SECRET', ''],
  ['GOOGLE_REDIRECT_URI', 'http://localhost:5000/api/auth/google/callback'],
  ['GOOGLE_REDIRECT_URI', 'https://backend.example.com/wrong'],
  ['JWT_SECRET', 'short'],
  ['ENCRYPTION_SECRET', 'short'],
  ['ENCRYPTION_SECRET', productionEnv.JWT_SECRET],
  ['DEMO_MODE', 'true'],
]) {
  test(`production: rejects unsafe ${name} (${value || 'missing'})`, () => {
    const result = checkEnv({ [name]: value });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(name));
  });
}

test('development: preserves local URLs and optional Google credentials', () => {
  assert.equal(checkEnv({ NODE_ENV: 'development', FRONTEND_URL: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '' }).status, 0);
});

test('production HTTP: health, CORS and OAuth redirects use the configured origin', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const server = require('./src/app').createApp().listen(0, '127.0.0.1', async () => {
      try {
        const base = 'http://127.0.0.1:' + server.address().port;
        const health = await fetch(base + '/api/health');
        assert.equal(health.status, 200);
        assert.equal((await health.json()).demoMode, false);
        for (const origin of ['https://frontend.example.com', 'http://localhost:3000', 'https://other.example.com']) {
          const response = await fetch(base + '/api/emails', {
            method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
          });
          assert.equal(response.headers.get('access-control-allow-origin'), origin === 'https://frontend.example.com' ? origin : null);
        }
        const callback = await fetch(base + '/api/auth/google/callback', { redirect: 'manual' });
        assert.equal(callback.headers.get('location'), 'https://frontend.example.com/login?error=invalid_request');
      } catch (error) {
        console.error(error);
        process.exitCode = 1;
      } finally { server.close(); server.closeAllConnections(); }
    });
  `], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, ...productionEnv, FRONTEND_URL: productionEnv.FRONTEND_URL + '/', JOBS_ENABLED: 'false' },
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
});
