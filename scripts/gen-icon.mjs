// Generates a placeholder 32x32 tray icon so the app has something to show
// before real artwork exists. Pure node, no image dependencies.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const SIZE = 32
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

// A rounded blue square with a white check mark.
const rows = []
for (let y = 0; y < SIZE; y++) {
  const row = [0]
  for (let x = 0; x < SIZE; x++) {
    const inset = 2, r = 6
    const cx = Math.min(Math.max(x, inset + r), SIZE - 1 - inset - r)
    const cy = Math.min(Math.max(y, inset + r), SIZE - 1 - inset - r)
    const inside = x >= inset && x < SIZE - inset && y >= inset && y < SIZE - inset &&
      (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    const onCheck =
      (Math.abs((y - 17) - (x - 9)) <= 1.5 && x >= 9 && x <= 14) ||
      (Math.abs((y - 22) + (x - 14)) <= 1.5 && x >= 14 && x <= 23)
    if (!inside) row.push(0, 0, 0, 0)
    else if (onCheck) row.push(255, 255, 255, 255)
    else row.push(37, 99, 235, 255)
  }
  rows.push(...row)
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8   // bit depth
ihdr[9] = 6   // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(Buffer.from(rows))),
  chunk('IEND', Buffer.alloc(0))
])
writeFileSync(new URL('../resources/tray.png', import.meta.url), png)
console.log(`wrote resources/tray.png (${png.length} bytes)`)
