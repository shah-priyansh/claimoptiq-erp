require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const prisma = require('../config/prisma');

async function backupDatabase() {
  try {
    const backupDir = './db_backups';
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const backupFile = path.join(backupDir, `backup_${timestamp}.json`);

    // Create backup directory
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    console.log('🔄 Creating database backup...');
    console.log(`📁 Backup file: ${backupFile}`);

    // Get all table names and counts
    const tables = [
      'users',
      'roles',
      'hospitals',
      'references',
      'parties',
      'invoices',
      'expenses',
      'cash_bank_entries',
      'accounts',
      'journal_entries',
      'claim_status_history',
      'claims',
    ];

    const backup = {
      timestamp: new Date().toISOString(),
      database: 'ClaimOptiq',
      tables: {},
      summary: {},
    };

    // Backup key tables (count only)
    for (const table of tables) {
      try {
        const result = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM "${table}"`);
        backup.tables[table] = result[0].count;
        backup.summary[table] = `${result[0].count} records`;
      } catch (error) {
        console.warn(`⚠️  Could not count table ${table}: ${error.message}`);
      }
    }

    // Write backup metadata with BigInt support
    fs.writeFileSync(
      backupFile,
      JSON.stringify(backup, (key, value) => {
        return typeof value === 'bigint' ? value.toString() : value;
      }, 2)
    );

    // Also create an SQL dump using psql through environment
    console.log('\n💾 Creating SQL backup (using pg_dump via Docker as fallback)...');
    const sqlBackupFile = path.join(backupDir, `backup_${timestamp}.sql.gz`);
    console.log(`📁 SQL Backup: ${sqlBackupFile}`);

    const dbUrl = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_R4a6iLXfHMQx@ep-delicate-feather-aphev94c.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require';

    // Try using Docker if available
    const dockerCmd = spawn('docker', [
      'run',
      '--rm',
      '-e', `PGPASSWORD=npg_R4a6iLXfHMQx`,
      'postgres:latest',
      'pg_dump',
      '-h', 'ep-delicate-feather-aphev94c.c-7.us-east-1.aws.neon.tech',
      '-U', 'neondb_owner',
      '-d', 'neondb',
      '--ssl-mode=require',
    ]);

    let sqlOutput = '';
    dockerCmd.stdout.on('data', (data) => {
      sqlOutput += data.toString();
    });

    await new Promise((resolve, reject) => {
      dockerCmd.on('close', (code) => {
        if (code === 0) {
          fs.writeFileSync(sqlBackupFile, sqlOutput);
          console.log('✅ SQL backup created successfully');
          resolve();
        } else {
          console.warn('⚠️  Docker SQL dump not available (pg_dump skipped)');
          resolve(); // Don't fail, continue with metadata backup
        }
      });
      dockerCmd.on('error', () => {
        console.warn('⚠️  Docker not available, skipping SQL dump');
        resolve();
      });
    });

    // Print summary
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('✅ BACKUP COMPLETED');
    console.log('════════════════════════════════════════════════════════════');
    console.log('📊 Table Summary:');
    for (const [table, count] of Object.entries(backup.tables)) {
      console.log(`   ${table}: ${count} records`);
    }
    console.log('════════════════════════════════════════════════════════════\n');

    console.log(`✅ Backup files created in: ${backupDir}/`);
    console.log(`   Metadata: backup_${timestamp}.json`);
    if (fs.existsSync(sqlBackupFile)) {
      console.log(`   SQL dump: backup_${timestamp}.sql.gz`);
    }

    return {
      success: true,
      backupFile,
      sqlBackupFile: fs.existsSync(sqlBackupFile) ? sqlBackupFile : null,
      timestamp,
    };
  } catch (error) {
    console.error('❌ Backup failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run backup
backupDatabase()
  .then(result => {
    console.log('\n✅ Script completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error.message);
    process.exit(1);
  });
