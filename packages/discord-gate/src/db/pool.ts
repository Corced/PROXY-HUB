import { Pool } from 'pg';
import { discordGateConfig } from '../config/discordGateConfig';

// Database pool built from env vars (no hardcoded host/user/db)
const pool = new Pool({
  host: discordGateConfig.POSTGRES_HOST,
  port: discordGateConfig.POSTGRES_PORT,
  user: discordGateConfig.POSTGRES_USER,
  password: discordGateConfig.DB_PASSWORD,
  database: discordGateConfig.POSTGRES_DB,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error', err);
});

export { pool };