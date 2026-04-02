const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');
const zipEncrypted = require('archiver-zip-encrypted');

const ZIP_ENCRYPTED_FORMAT = 'zip-encrypted';
const PASSWORD = 'securezip-poc-password';

function ensureZipEncryptedFormatRegistered() {
  if (!archiver.isRegisteredFormat(ZIP_ENCRYPTED_FORMAT)) {
    archiver.registerFormat(ZIP_ENCRYPTED_FORMAT, zipEncrypted);
  }
}

async function createEncryptedZip(outFile, entries) {
  await fs.promises.mkdir(path.dirname(outFile), { recursive: true });

  const output = fs.createWriteStream(outFile);
  const archive = archiver(ZIP_ENCRYPTED_FORMAT, {
    zlib: { level: 9 },
    encryptionMethod: 'aes256',
    password: PASSWORD,
  });

  const closed = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('warning', (err) => {
      console.warn('[PoC] archiver warning:', err.message);
    });
    archive.on('error', reject);
  });

  archive.pipe(output);
  for (const entry of entries) {
    archive.file(entry.absPath, { name: entry.archivePath });
  }

  await archive.finalize();
  await closed;
}

async function main() {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'securezip-encrypted-poc-'));
  try {
    const fixtureRoot = path.join(tempRoot, 'fixture');
    await fs.promises.mkdir(fixtureRoot, { recursive: true });
    const fixtureFile = path.join(fixtureRoot, 'hello.txt');
    await fs.promises.writeFile(fixtureFile, 'SecureZip encrypted ZIP PoC\n', 'utf8');

    const entries = [{ absPath: fixtureFile, archivePath: 'hello.txt' }];
    const firstOut = path.join(tempRoot, 'first-encrypted.zip');
    const secondOut = path.join(tempRoot, 'second-encrypted.zip');

    ensureZipEncryptedFormatRegistered();
    await createEncryptedZip(firstOut, entries);

    // Run the same flow again in the same process to verify no duplicate-register error occurs.
    ensureZipEncryptedFormatRegistered();
    await createEncryptedZip(secondOut, entries);

    const [firstStat, secondStat] = await Promise.all([
      fs.promises.stat(firstOut),
      fs.promises.stat(secondOut),
    ]);

    if (firstStat.size <= 0 || secondStat.size <= 0) {
      throw new Error('PoC generated an empty encrypted ZIP.');
    }

    console.log('[PoC] Encrypted ZIP generation succeeded twice in one session.');
    console.log(`[PoC] first:  ${firstOut} (${firstStat.size} bytes)`);
    console.log(`[PoC] second: ${secondOut} (${secondStat.size} bytes)`);
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('[PoC] Failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
