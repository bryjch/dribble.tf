// Reads files out of Valve VPK archives (versions 1 and 2): the `_dir.vpk` holds the file tree and
// small files, and numbered `_NNN.vpk` archives next to it hold the rest.
import fs from 'node:fs'
import path from 'node:path'

const SIGNATURE = 0x55aa1234
const IN_DIRECTORY = 0x7fff

export class Vpk {
  /** @param {string} dirPath a `*_dir.vpk` file */
  constructor(dirPath) {
    this.dirPath = dirPath
    this.prefix = dirPath.replace(/_dir\.vpk$/i, '')
    this.entries = new Map()
    this.handles = new Map()
    const data = fs.readFileSync(dirPath)
    if (data.readUInt32LE(0) !== SIGNATURE) throw new Error(`${dirPath} is not a VPK`)
    const version = data.readUInt32LE(4)
    const treeSize = data.readUInt32LE(8)
    const headerSize = version === 1 ? 12 : version === 2 ? 28 : null
    if (headerSize === null) throw new Error(`${dirPath}: unsupported VPK version ${version}`)
    this.data = data
    this.dataStart = headerSize + treeSize

    let at = headerSize
    const string = () => {
      const end = data.indexOf(0, at)
      const value = data.toString('latin1', at, end)
      at = end + 1
      return value
    }
    for (let ext = string(); ext !== ''; ext = string()) {
      for (let dir = string(); dir !== ''; dir = string()) {
        for (let name = string(); name !== ''; name = string()) {
          const preloadBytes = data.readUInt16LE(at + 4)
          const entry = {
            archive: data.readUInt16LE(at + 6),
            offset: data.readUInt32LE(at + 8),
            length: data.readUInt32LE(at + 12),
            preloadStart: at + 18,
            preloadBytes,
          }
          at += 18 + preloadBytes
          const file = (dir === ' ' ? '' : `${dir}/`) + (ext === ' ' ? name : `${name}.${ext}`)
          this.entries.set(file.toLowerCase(), entry)
        }
      }
    }
  }

  has(file) {
    return this.entries.has(normalize(file))
  }

  /** The file's bytes, or null when the archive does not have it. */
  read(file) {
    const entry = this.entries.get(normalize(file))
    if (!entry) return null
    const preload = this.data.subarray(entry.preloadStart, entry.preloadStart + entry.preloadBytes)
    if (entry.length === 0) return Buffer.from(preload)
    let body
    if (entry.archive === IN_DIRECTORY) {
      const start = this.dataStart + entry.offset
      body = this.data.subarray(start, start + entry.length)
    } else {
      body = Buffer.alloc(entry.length)
      fs.readSync(this.handle(entry.archive), body, 0, entry.length, entry.offset)
    }
    return Buffer.concat([preload, body])
  }

  handle(archive) {
    let fd = this.handles.get(archive)
    if (fd === undefined) {
      fd = fs.openSync(`${this.prefix}_${String(archive).padStart(3, '0')}.vpk`, 'r')
      this.handles.set(archive, fd)
    }
    return fd
  }

  close() {
    for (const fd of this.handles.values()) fs.closeSync(fd)
    this.handles.clear()
  }
}

/** Several archives searched in order, like the game's mounted search paths. */
export class VpkSet {
  constructor(dirPaths) {
    this.vpks = dirPaths.filter(p => fs.existsSync(p)).map(p => new Vpk(p))
  }

  static forGame(gameDir, hl2Dir) {
    const dirs = [gameDir, hl2Dir].filter(Boolean)
    const files = dirs.flatMap(d =>
      fs
        .readdirSync(d)
        .filter(n => /_dir\.vpk$/i.test(n))
        .sort()
        .map(n => path.join(d, n))
    )
    return new VpkSet(files)
  }

  has(file) {
    return this.vpks.some(v => v.has(file))
  }

  read(file) {
    for (const v of this.vpks) {
      const data = v.read(file)
      if (data) return data
    }
    return null
  }

  close() {
    for (const v of this.vpks) v.close()
  }
}

const normalize = file => file.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
