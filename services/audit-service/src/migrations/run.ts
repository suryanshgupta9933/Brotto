import { readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { Pool } from 'pg';

interface MigrationResult {
  version: number;
  applied: boolean;
  error?: string;
}

async function runMigrations(databaseUrl: string): Promise<MigrationResult[]> {
  const pool = new Pool({ connectionString: databaseUrl });
  const results: MigrationResult[] = [];

  try {
    // Ensure schema_version table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        description TEXT
      )
    `);

    // Get applied migrations
    const appliedResult = await pool.query('SELECT version FROM schema_version ORDER BY version');
    const appliedVersions = new Set(appliedResult.rows.map((r) => r.version));

    // Get migration files
    const migrationsDir = join(__dirname, '../../migrations');
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const version = parseInt(basename(file).split('_')[0], 10);

      if (isNaN(version)) {
        console.warn(`Skipping invalid migration filename: ${file}`);
        continue;
      }

      if (appliedVersions.has(version)) {
        console.log(`Migration ${version} already applied, skipping`);
        results.push({ version, applied: true });
        continue;
      }

      console.log(`Applying migration ${version}: ${file}`);
      const sql = readFileSync(join(migrationsDir, file), 'utf-8');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);

        // Record the migration
        await client.query(
          `INSERT INTO schema_version (version, applied_at, description) VALUES ($1, NOW(), $2)`,
          [version, file]
        );

        await client.query('COMMIT');
        console.log(`Migration ${version} applied successfully`);
        results.push({ version, applied: true });
      } catch (error) {
        await client.query('ROLLBACK');
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Migration ${version} failed: ${errorMessage}`);
        results.push({ version, applied: false, error: errorMessage });
        throw error;
      } finally {
        client.release();
      }
    }

    return results;
  } finally {
    await pool.end();
  }
}

// CLI entry point
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

runMigrations(databaseUrl)
  .then((results) => {
    const failed = results.filter((r) => !r.applied);
    if (failed.length > 0) {
      console.error('Some migrations failed:', failed);
      process.exit(1);
    }
    console.log('All migrations completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration error:', error);
    process.exit(1);
  });
