/**
 * 生成占位应用图标。
 *
 * 为什么要有这个脚本:`tauri build`/`tauri dev` 在 Windows 上必须有 `icons/icon.ico`,否则
 * tauri-build 直接失败。图标内容不是产品决策,所以这里生成一张纯色占位图,再用 `tauri icon`
 * 展开成各平台需要的尺寸;换成真实图标时删掉本脚本与 `shell/app-icon.png` 即可。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const SIZE = 1024
const BACKGROUND = [0x12, 0x14, 0x1a, 0xff]
const MARK = [0x6a, 0xa9, 0xff, 0xff]

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

/**
 * @param bytes 待校验的字节
 * @returns PNG 用的 CRC-32
 */
function crc32(bytes) {
  let crc = 0xffff_ffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffff_ffff) >>> 0
}

/**
 * @param type 块类型
 * @param data 块数据
 * @returns 一个完整的 PNG 块
 */
function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const name = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, crc])
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
let offset = 0
for (let y = 0; y < SIZE; y++) {
  raw[offset++] = 0
  for (let x = 0; x < SIZE; x++) {
    const inside = x > SIZE * 0.28 && x < SIZE * 0.72 && y > SIZE * 0.28 && y < SIZE * 0.72
    const ring = Math.abs(Math.hypot(x - SIZE / 2, y - SIZE / 2) - SIZE * 0.22) < SIZE * 0.03
    const color = inside && !ring ? MARK : BACKGROUND
    raw[offset++] = color[0]
    raw[offset++] = color[1]
    raw[offset++] = color[2]
    raw[offset++] = color[3]
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8
ihdr[9] = 6
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app-icon.png')
fs.writeFileSync(out, png)
console.log(`占位图标:${out}(${png.length} B)`)
