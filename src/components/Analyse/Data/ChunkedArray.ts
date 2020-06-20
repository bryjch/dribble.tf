export type DataArray = Uint32Array | Uint8Array | Uint16Array

/**
 * Growable typed array using chunking
 */
export class ChunkedArray {
  bitWidth: 8 | 16 | 32
  chunkLength: number
  chunkBitCount: number
  chunkBitMask: number
  chunks: DataArray[]

  constructor(bitWidth: 8 | 16 | 32, chunkLength: number = 0) {
    if (chunkLength && !this.isPow2(chunkLength)) {
      throw new Error('Chunk length must be a power of 2')
    }
    this.chunkLength = chunkLength || 1048576 //1MB for uint8array
    this.chunkBitCount = Math.log2(this.chunkLength)
    this.chunkBitMask = (1 << this.chunkBitCount) - 1
    this.addChunk()
  }

  private isPow2(number: any) {
    return number != 0 && (number & (number - 1)) == 0
  }

  private addChunk() {
    this.chunks.push(this.createDataArray())
  }

  private createDataArray(): DataArray {
    switch (this.bitWidth) {
      case 8:
        return new Uint16Array(this.chunkLength)
      case 16:
        return new Uint16Array(this.chunkLength)
      case 32:
        return new Uint32Array(this.chunkLength)
    }
  }

  public get(offset: number): number {
    const chunk = offset >> this.chunkBitCount
    const chunkOffset = offset & this.chunkBitMask
    return this.chunks[chunk][chunkOffset]
  }

  public set(offset: number, value: number) {
    const chunk = offset >> this.chunkBitCount
    const chunkOffset = offset & this.chunkBitMask
    this.chunks[chunk][chunkOffset] = value
  }
}
