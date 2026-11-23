// Jest setup: read the same .env files as the API, so DATABASE_URL from the root .env
// reaches the database tests (which still refuse non-local hosts).
import { loadEnv } from './load-env';

loadEnv();
