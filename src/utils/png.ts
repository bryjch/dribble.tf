/**
 * Decodes an 8-bit, non-interlaced RGBA or RGB PNG to RGBA bytes, byte for byte.
 *
 * For PNGs whose alpha is data, not coverage (the lightmaps' RGBExp32 exponent). WebKit, which
 * every browser on iOS uses, premultiplies alpha when it decodes an image whatever
 * createImageBitmap's premultiplyAlpha says, so texels with a small exponent byte come back
 * black or saturated. Decoding here sidesteps the browser's image decoder altogether.
 */
export async function decodePng(
  bytes: Uint8Array
): Promise<{ width: number; height: number; data: Uint8Array<ArrayBuffer> }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) {
    throw new Error('not a PNG')
  }
  let width = 0
  let height = 0
  let channels = 0
  const idat: Uint8Array[] = []
  for (let offset = 8; offset + 8 <= bytes.byteLength; ) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8)
      height = view.getUint32(offset + 12)
      const [bitDepth, colorType, , , interlace] = body.subarray(8, 13)
      channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
      if (bitDepth !== 8 || !channels || interlace !== 0) {
        throw new Error(`unsupported PNG (depth ${bitDepth}, colour ${colorType}, interlace ${interlace})`)
      }
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (!width || !height || !idat.length) throw new Error('PNG has no image data')

  // IDAT is a zlib stream, which DecompressionStream calls 'deflate'.
  const inflated = new Uint8Array(
    await new Response(
      new Blob(idat as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate'))
    ).arrayBuffer()
  )
  const stride = width * channels
  if (inflated.byteLength < (stride + 1) * height) throw new Error('PNG image data is truncated')

  // Undo each row's filter (PNG spec section 9), then widen to RGBA. Row 0 reads a zero row above.
  const raw = new Uint8Array(stride * height)
  const zero = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)]
    const source = inflated.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const row = raw.subarray(y * stride, (y + 1) * stride)
    const up = y > 0 ? raw.subarray((y - 1) * stride, y * stride) : zero
    const c = channels
    if (filter === 0) {
      row.set(source)
    } else if (filter === 1) {
      for (let x = 0; x < c; x++) row[x] = source[x]
      for (let x = c; x < stride; x++) row[x] = source[x] + row[x - c]
    } else if (filter === 2) {
      for (let x = 0; x < stride; x++) row[x] = source[x] + up[x]
    } else if (filter === 3) {
      for (let x = 0; x < c; x++) row[x] = source[x] + (up[x] >> 1)
      for (let x = c; x < stride; x++) row[x] = source[x] + ((row[x - c] + up[x]) >> 1)
    } else if (filter === 4) {
      for (let x = 0; x < c; x++) row[x] = source[x] + up[x]
      for (let x = c; x < stride; x++) {
        const a = row[x - c]
        const b = up[x]
        const d = up[x - c]
        const pa = Math.abs(b - d)
        const pb = Math.abs(a - d)
        const pc = Math.abs(a + b - 2 * d)
        row[x] = source[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : d)
      }
    } else {
      throw new Error(`bad PNG filter ${filter}`)
    }
  }
  if (channels === 4) return { width, height, data: raw }
  const data = new Uint8Array(width * height * 4)
  for (let i = 0, j = 0; i < raw.length; i += 3, j += 4) {
    data[j] = raw[i]
    data[j + 1] = raw[i + 1]
    data[j + 2] = raw[i + 2]
    data[j + 3] = 255
  }
  return { width, height, data }
}
