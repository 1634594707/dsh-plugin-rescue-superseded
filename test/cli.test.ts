/**
 * argv 是写动作的第一道闸:开关拼错或被无声吞掉,后果是拿真 profile 试刀。这里钉住映射与拒绝面。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { main, parseArgv } from '../src/cli.ts'

test('flags map to the keys the code reads, not the spelling on screen', () => {
  const parsed = parseArgv(['fix', 'exempt', '@a/b@1.0.0', '--runtime', '0.2.0-rc.1', '--accept-risk', '--dry-run'])
  assert.equal(parsed.command, 'fix')
  assert.equal(parsed.subject, 'exempt')
  assert.deepEqual(parsed.positional, ['@a/b@1.0.0'])
  assert.equal(parsed.flags.runtime, '0.2.0-rc.1')
  assert.equal(parsed.flags.acceptRisk, true)
  assert.equal(parsed.flags.dryRun, true)
})

test('an unknown flag is an error, never a silently dropped safety switch', () => {
  assert.throws(() => parseArgv(['doctor', '--dryrun']), /不认识开关 --dryrun/)
})

test('--runtime is refused where nothing would read it', async () => {
  await assert.rejects(() => main(['doctor', '--runtime', '0.2.0-rc.1']), /doctor 不用 --runtime/)
})

test('--runtime stays accepted where it is the whole point', async () => {
  // 用一个不存在的 profile:命令会因找不到 profile 失败,但绝不会被 --runtime 的拒绝挡住 —— 也不碰任何写路径。
  await assert.rejects(
    () => main(['market', '--profile', 'no-such-profile', '--runtime', '0.2.0-rc.1']),
    (error: unknown) => {
      assert.doesNotMatch(String(error), /不用 --runtime/, `实际报错:${String(error)}`)
      return true
    },
  )
})
