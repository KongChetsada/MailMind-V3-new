require('dotenv').config();
const { env, assertRequiredEnv } = require('./src/config/env');

assertRequiredEnv();

const { createApp } = require('./src/app');
const { startJobs } = require('./src/jobs/runner');
const { createLogger } = require('./src/utils/logger');

const logger = createLogger('SYSTEM');

createApp().listen(env.port, () => {
  logger.info('SERVER_STARTED', `MailMind backend is running on port ${env.port}`, {
    frontendUrl: env.frontendUrl,
    localAiBaseUrl: env.localAi.baseUrl,
    localAiModel: env.localAi.model,
  });
  startJobs();
});
