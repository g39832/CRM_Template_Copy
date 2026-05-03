const fs = require('fs');
const path = require('path');
const { runBackup } = require('../services/db-backup');

const backupDir = path.resolve(__dirname, '..', 'backups');
const prefix = 'crm-backup-';

function listBackups() {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .map((name) => {
      const fullPath = path.join(backupDir, name);
      return { name, fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function verifySnapshot(snapshotPath) {
  const raw = fs.readFileSync(snapshotPath, 'utf8');
  const snapshot = JSON.parse(raw);
  const requiredTables = ['settings', 'clients', 'payments', 'notes', 'finance_overrides'];

  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Backup snapshot is not a valid object');
  }
  if (!snapshot.tables || typeof snapshot.tables !== 'object') {
    throw new Error('Backup snapshot is missing tables');
  }

  for (const table of requiredTables) {
    if (!Array.isArray(snapshot.tables[table])) {
      throw new Error(`Missing backup table: ${table}`);
    }
  }
}

async function main() {
  let backups = listBackups();
  if (!backups.length) {
    await runBackup({ retention: 30 });
    backups = listBackups();
  }

  if (!backups.length) {
    throw new Error('No backups available after backup creation attempt.');
  }

  const latest = backups[0];
  verifySnapshot(latest.fullPath);
  console.log(`Backup restore verification passed: ${latest.name}`);
}

main().catch((err) => {
  console.error('Backup restore verification failed:', err.message);
  process.exit(1);
});
