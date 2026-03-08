/**
 * Backend config from environment.
 */
require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
  nodeEnv: process.env.NODE_ENV || 'development',
};
