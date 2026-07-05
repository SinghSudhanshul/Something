import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { ElasticsearchContainer } from '@testcontainers/elasticsearch';
import { MongoDBContainer } from '@testcontainers/mongodb';
import { execSync } from 'child_process';
import path from 'path';

let pgContainer: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>> | null = null;
let redisContainer: Awaited<ReturnType<typeof RedisContainer.prototype.start>> | null = null;
let esContainer: Awaited<ReturnType<typeof ElasticsearchContainer.prototype.start>> | null = null;
let mongoContainer: Awaited<ReturnType<typeof MongoDBContainer.prototype.start>> | null = null;

export async function startContainers() {
  console.log('Starting testcontainers (PostgreSQL, Redis, Elasticsearch, MongoDB)...');
  
  const [pg, redis, es, mongo] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('nexus_test')
      .withUsername('nexus_user')
      .withPassword('nexus_password')
      .start(),
    new RedisContainer('redis:7-alpine').start(),
    new ElasticsearchContainer('docker.elastic.co/elasticsearch/elasticsearch:8.11.3')
      .withEnvironment({
        'discovery.type': 'single-node',
        'xpack.security.enabled': 'false',
        'ES_JAVA_OPTS': '-Xms512m -Xmx512m'
      })
      .start(),
    new MongoDBContainer('mongo:7.0').start()
  ]);

  pgContainer = pg;
  redisContainer = redis;
  esContainer = es;
  mongoContainer = mongo;

  const dbUrl = pg.getConnectionUri();
  
  // Run migrations
  console.log('Running database migrations on testcontainer...');
  process.env.DATABASE_URL = dbUrl;
  const workspaceRoot = path.resolve(__dirname, '../../');
  execSync('pnpm --filter @nexus/database run migrate', { cwd: workspaceRoot, stdio: 'inherit' });

  return {
    DATABASE_URL: dbUrl,
    REDIS_URL: redis.getConnectionUrl(),
    ELASTICSEARCH_URL: es.getHttpUrl(),
    MONGODB_URL: mongo.getConnectionString()
  };
}

export async function stopContainers() {
  console.log('Stopping testcontainers...');
  await Promise.all([
    pgContainer?.stop(),
    redisContainer?.stop(),
    esContainer?.stop(),
    mongoContainer?.stop()
  ]);
}
