import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  backupPathFor,
  BACKUP_KEEP,
  listBackupPaths,
  pruneBackups,
  RETRYABLE_WRITE_ERRORS,
  retryDelayMs,
  ReadOnlyConfigError,
  snapshotFile,
  stampFor,
  tempPathFor,
  WRITE_RETRY_DELAY_MS,
  WRITE_RETRY_LIMIT,
  writeFileAtomically,
} from '../src/write/atomic.ts'

const FIRST = '2026-09-29T03:35:00.123Z'
const SECOND = '2026-09-29T03:36:00.234Z'

/**
 * @returns {Promise<string>} 一个只属于本次测试的临时目录
 */
async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rescue-atomic-'))
}

test('the retry constants are the host constants', () => {
  assert.equal(WRITE_RETRY_LIMIT, 10)
  assert.equal(WRITE_RETRY_DELAY_MS, 50)
  assert.deepEqual([...RETRYABLE_WRITE_ERRORS].sort(), ['EACCES', 'EBUSY', 'EPERM'])
  assert.equal(retryDelayMs(0), 50)
  assert.equal(retryDelayMs(WRITE_RETRY_LIMIT - 1), 500)
  assert.equal(stampFor(FIRST), '20260929T033500123Z')
})

test('a first write creates the file and leaves no temporary behind', async () => {
  const dir = await tempDir()
  const target = path.join(dir, 'cordis.patch.yml')
  const result = await writeFileAtomically(target, '- id: a\n', { stamp: FIRST })
  assert.equal(result.backupPath, undefined)
  assert.equal(await fs.readFile(target, 'utf8'), '- id: a\n')
  assert.deepEqual(await fs.readdir(dir), ['cordis.patch.yml'])
})

test('the second write leaves the previous content in a .bak and reuses nothing', async () => {
  const dir = await tempDir()
  const target = path.join(dir, 'cordis.patch.yml')
  await writeFileAtomically(target, 'one\n', { stamp: FIRST })
  const second = await writeFileAtomically(target, 'two\n', { stamp: SECOND })
  assert.equal(second.backupPath, backupPathFor(target, stampFor(SECOND)))
  assert.equal(await fs.readFile(second.backupPath!, 'utf8'), 'one\n')
  assert.equal(await fs.readFile(target, 'utf8'), 'two\n')
  assert.equal(tempPathFor(target, stampFor(SECOND)).endsWith(`.tmp-${stampFor(SECOND)}`), true)
})

test('backups are capped at the newest few per file', async () => {
  const dir = await tempDir()
  const target = path.join(dir, 'compatibility.json')
  for (const stamp of ['2026-01-01T00:00:00.001Z', '2026-01-01T00:00:00.002Z', '2026-01-01T00:00:00.003Z', '2026-01-01T00:00:00.004Z', '2026-01-01T00:00:00.005Z']) {
    await writeFileAtomically(target, `${stamp}\n`, { stamp })
  }
  const remaining = await listBackupPaths(target)
  assert.equal(remaining.length, BACKUP_KEEP)
  assert.match(remaining[0]!, /0005Z$/)
})

test('pruneBackups reports what it deleted and keeps the configured few', async () => {
  const dir = await tempDir()
  const target = path.join(dir, 'compatibility.json')
  await fs.writeFile(target, 'now\n')
  for (const stamp of ['2026-01-01T00:00:00.001Z', '2026-01-01T00:00:00.002Z', '2026-01-01T00:00:00.003Z', '2026-01-01T00:00:00.004Z']) {
    await fs.writeFile(`${target}.bak-${stampFor(stamp)}`, 'old\n')
  }
  assert.equal((await pruneBackups(target, 2)).length, 2)
  assert.equal((await listBackupPaths(target)).length, 2)
})

test('the snapshot is a content hash, not a length or a line count', async () => {
  const dir = await tempDir()
  const target = path.join(dir, 'cordis.patch.yml')
  await fs.writeFile(target, '- id: a\n  config:\n    keep: 1\n')
  const before = await snapshotFile(target)
  await fs.writeFile(target, '- id: a\n  config:\n    keep: 2\n')
  const after = await snapshotFile(target)
  assert.notEqual(before.sha256, after.sha256)
  assert.equal(before.path, target)
  assert.ok(Number.isFinite(before.mtimeMs))
})

test('a read-only target is refused before anything is copied', { skip: process.platform === 'win32' }, async () => {
  const dir = await tempDir()
  const target = path.join(dir, 'cordis.patch.yml')
  await fs.writeFile(target, 'original\n')
  await fs.chmod(target, 0o444)
  await assert.rejects(() => writeFileAtomically(target, 'rewritten\n', { stamp: FIRST }), ReadOnlyConfigError)
  assert.equal(await fs.readFile(target, 'utf8'), 'original\n')
  assert.deepEqual(await fs.readdir(dir), ['cordis.patch.yml'])
  await fs.chmod(target, 0o644)
})
