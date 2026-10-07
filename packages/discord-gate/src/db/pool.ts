import { Pool } from 'pg';
import { discordGateConfig } from '../config/discordGateConfig';

// Test database pool
const pool = new Pool({
  connectionString: `postgresql://root:${discordGateConfig.DB_PASSWORD}@postgres:5432/new-api`,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error', err);
});

export { pool };