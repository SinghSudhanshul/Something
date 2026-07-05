/**
 * Search Service Configuration
 *
 * @module config
 */

export const config = {
  // Server
  SEARCH_PORT: parseInt(process.env.SEARCH_PORT ?? process.env.PORT ?? '3011', 10),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',

  // Database
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://nexus:nexus@localhost:5432/nexus',

  // Redis
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',

  // Kafka
  KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? 'localhost:9092',

  // Elasticsearch
  ELASTICSEARCH_URL: process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200',
  ELASTICSEARCH_INDEX_PREFIX: process.env.ELASTICSEARCH_INDEX_PREFIX ?? 'nexus',
  ELASTICSEARCH_USERNAME: process.env.ELASTICSEARCH_USERNAME ?? '',
  ELASTICSEARCH_PASSWORD: process.env.ELASTICSEARCH_PASSWORD ?? '',

  // Security
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'nexus-dev-jwt-secret',
  INTERNAL_SERVICE_SECRET: process.env.INTERNAL_SERVICE_SECRET ?? 'nexus-internal-secret',

  // CORS
  SEARCH_CORS_ORIGIN: process.env.SEARCH_CORS_ORIGIN ?? '*',

  DATABASE_POOL_MAX: parseInt(process.env.DATABASE_POOL_MAX ?? '20', 10),
  DATABASE_IDLE_TIMEOUT_SECS: parseInt(process.env.DATABASE_IDLE_TIMEOUT_SECS ?? '10', 10),
  DATABASE_CONNECT_TIMEOUT_SECS: parseInt(process.env.DATABASE_CONNECT_TIMEOUT_SECS ?? '10', 10),
  
  KAFKA_CLIENT_ID: process.env.KAFKA_CLIENT_ID ?? 'nexus-search-service',
  KAFKA_PRODUCER_RETRIES: parseInt(process.env.KAFKA_PRODUCER_RETRIES ?? '3', 10),
  
  REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX ?? 'nexus:search:',
  REDIS_MAX_RETRIES: parseInt(process.env.REDIS_MAX_RETRIES ?? '3', 10),
} as const;
