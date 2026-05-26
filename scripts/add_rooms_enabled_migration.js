const { Pool } = require('pg');
(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not set in environment.');
    process.exit(2);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    console.log('Running migration: ADD COLUMN IF NOT EXISTS rooms_enabled');
    await client.query(`ALTER TABLE menus ADD COLUMN IF NOT EXISTS rooms_enabled INTEGER NOT NULL DEFAULT 0`);
    console.log('ALTER_OK');
    await client.query('RELEASE');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message || err);
    try { await pool.end(); } catch(e){}
    process.exit(1);
  } finally {
    try{ client.release(); } catch(e){}
  }
})();
