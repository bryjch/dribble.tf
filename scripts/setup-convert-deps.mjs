#!/usr/bin/env node
/**
 * Setup / dependency checker for the BSP-to-GLB conversion pipeline.
 *
 * Checks that all required tools are installed and accessible, downloads
 * BSPSource and gltfpack if missing, and creates a starter config file.
 *
 * Usage:
 *   node scripts/setup-convert-deps.mjs [--config <path>]
 */

import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { execSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const ok = msg => console.log(`  \x1b[32m✓\x1b[0m ${msg}`)
const warn = msg => console.log(`  \x1b[33m!\x1b[0m ${msg}`)
const fail = msg => console.log(`  \x1b[31m✗\x1b[0m ${msg}`)

const which = cmd => {
  try {
    return execSync(`which ${cmd}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

const checkCommand = (cmd, versionFlag = '--version') => {
  try {
    const result = spawnSync(cmd, [versionFlag], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    })
    return (result.stdout || result.stderr || '').trim().split('\n')[0]
  } catch {
    return null
  }
}

const downloadFile = (url, destination) => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination)

    const request = urlString => {
      https.get(urlString, response => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume()
          request(response.headers.location)
          return
        }
        if (response.statusCode !== 200) {
          response.resume()
          reject(new Error(`Download failed: HTTP ${response.statusCode} for ${urlString}`))
          return
        }
        response.pipe(file)
        file.on('finish', () => file.close(resolve))
      }).on('error', reject)
    }

    file.on('error', err => {
      fs.unlinkSync(destination)
      reject(err)
    })

    request(url)
  })
}

let allGood = true
const problems = []

const require = (condition, message) => {
  if (!condition) {
    allGood = false
    problems.push(message)
    fail(message)
  }
}

console.log('')
console.log('Checking conversion pipeline dependencies...')
console.log('')

// ── 1. Java (for BSPSource) ──
console.log('Java:')
const javaVersion = checkCommand('java', '-version')
if (javaVersion) {
  ok(`Found: ${javaVersion}`)
} else {
  require(false, 'Java not found. Install with: brew install openjdk')
}

// ── 2. Node.js ──
console.log('Node.js:')
const nodeVersion = checkCommand('node')
if (nodeVersion) {
  ok(`Found: ${nodeVersion}`)
  const major = Number(nodeVersion.replace(/^v/, '').split('.')[0])
  if (major < 18) {
    warn('Node.js 18+ recommended. Some features may not work on older versions.')
  }
} else {
  require(false, 'Node.js not found.')
}

// ── 3. Python 3 ──
console.log('Python:')
const python3Path = which('python3')
const pythonVersion = checkCommand('python3')
if (pythonVersion) {
  ok(`Found: ${pythonVersion}`)
} else {
  require(false, 'Python 3 not found. Install with: brew install python')
}

// ── 4. Python packages ──
console.log('Python packages:')
const checkPythonPackage = name => {
  try {
    const result = spawnSync('python3', ['-c', `import ${name}; print(${name}.__version__ if hasattr(${name}, '__version__') else 'installed')`], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    })
    if (result.status === 0) {
      return result.stdout.trim()
    }
  } catch { /* ignore */ }
  return null
}

const vtf2imgVersion = checkPythonPackage('vtf2img')
if (vtf2imgVersion) {
  ok(`vtf2img: ${vtf2imgVersion}`)
} else {
  require(false, 'vtf2img not installed. Install with: pip install vtf2img')
}

const vpkVersion = checkPythonPackage('vpk')
if (vpkVersion) {
  ok(`vpk: ${vpkVersion}`)
} else {
  require(false, 'vpk not installed. Install with: pip install vpk')
}

const pillowVersion = checkPythonPackage('PIL')
if (pillowVersion) {
  ok(`Pillow: ${pillowVersion}`)
} else {
  require(false, 'Pillow not installed. Install with: pip install Pillow')
}

// ── 5. Blender ──
console.log('Blender:')
const blenderCandidates = [
  '/Applications/Blender.app/Contents/MacOS/Blender',
  which('blender'),
].filter(Boolean)

let blenderFound = null
for (const candidate of blenderCandidates) {
  if (fs.existsSync(candidate)) {
    const version = checkCommand(candidate)
    if (version) {
      blenderFound = { path: candidate, version }
      break
    }
  }
}

if (blenderFound) {
  ok(`Found: ${blenderFound.version} at ${blenderFound.path}`)
} else {
  require(false, 'Blender not found. Install from blender.org or: brew install --cask blender')
}

// Check Plumber extension
if (blenderFound) {
  console.log('Plumber extension:')
  try {
    const result = spawnSync(blenderFound.path, [
      '-b', '-noaudio', '--python-expr',
      'import addon_utils; loaded = [m.__name__ for m in addon_utils.modules() if "plumber" in m.__name__.lower()]; print("PLUMBER_FOUND:" + str(len(loaded) > 0))',
    ], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    })
    const output = result.stdout + result.stderr
    if (output.includes('PLUMBER_FOUND:True')) {
      ok('Plumber extension detected in Blender.')
    } else {
      warn('Could not confirm Plumber extension. Make sure it is installed in Blender.')
    }
  } catch {
    warn('Could not check for Plumber extension.')
  }
}

// ── 6. ImageMagick ──
console.log('ImageMagick:')
const magickVersion = checkCommand('magick')
if (magickVersion) {
  ok(`Found: ${magickVersion}`)
} else {
  warn('ImageMagick (magick) not found. Needed for skybox color fallbacks. Install with: brew install imagemagick')
}

// ── 7. BSPSource ──
console.log('BSPSource:')
const bspsrcToolDir = path.join(repoRoot, 'scripts', 'tools', 'bspsrc')
const bspsrcJar = path.join(bspsrcToolDir, 'bspsrc.jar')
const bspsrcSh = path.join(bspsrcToolDir, 'bspsrc.sh')

if (fs.existsSync(bspsrcJar) || fs.existsSync(bspsrcSh)) {
  ok(`Found at ${bspsrcToolDir}`)
} else {
  warn('BSPSource not found locally. Attempting to download...')
  const bspsrcUrl = 'https://github.com/ata4/bspsrc/releases/download/v1.4.7/bspsrc-1.4.7.zip'
  const bspsrcZip = path.join(repoRoot, 'scripts', 'tools', 'bspsrc.zip')
  try {
    fs.mkdirSync(path.join(repoRoot, 'scripts', 'tools'), { recursive: true })
    console.log(`  Downloading BSPSource from ${bspsrcUrl}...`)
    await downloadFile(bspsrcUrl, bspsrcZip)
    fs.mkdirSync(bspsrcToolDir, { recursive: true })
    execSync(`unzip -o "${bspsrcZip}" -d "${bspsrcToolDir}"`, { stdio: 'inherit' })
    fs.unlinkSync(bspsrcZip)

    // Handle nested directory from zip
    const entries = fs.readdirSync(bspsrcToolDir)
    if (entries.length === 1) {
      const nested = path.join(bspsrcToolDir, entries[0])
      if (fs.statSync(nested).isDirectory()) {
        for (const file of fs.readdirSync(nested)) {
          fs.renameSync(path.join(nested, file), path.join(bspsrcToolDir, file))
        }
        fs.rmdirSync(nested)
      }
    }

    if (fs.existsSync(bspsrcJar) || fs.existsSync(path.join(bspsrcToolDir, 'bspsrc.sh'))) {
      ok('BSPSource downloaded and extracted.')
    } else {
      warn('BSPSource downloaded but jar/sh not found in expected location. Check scripts/tools/bspsrc/')
    }
  } catch (err) {
    require(false, `BSPSource download failed: ${err.message}. Download manually from https://github.com/ata4/bspsrc/releases`)
  }
}

// ── 8. gltfpack ──
console.log('gltfpack:')
const gltfpackDir = path.join(repoRoot, 'scripts', 'tools', 'gltfpack')
const gltfpackPath = path.join(gltfpackDir, 'gltfpack')

if (fs.existsSync(gltfpackPath)) {
  const version = checkCommand(gltfpackPath)
  ok(`Found: ${version || 'unknown version'} at ${gltfpackPath}`)
} else {
  warn('gltfpack not found locally. Attempting to download...')
  // Detect architecture for correct binary
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const gltfpackRelease = 'v0.22'
  const binaryName = arch === 'arm64' ? 'gltfpack-macos-arm64' : 'gltfpack-macos-x64'
  const gltfpackUrl = `https://github.com/nicedoc/gltfpack/releases/download/${gltfpackRelease}/${binaryName}`
  // Alternative: official meshoptimizer releases
  const meshoptUrl = `https://github.com/zeux/meshoptimizer/releases/latest/download/gltfpack-${process.platform === 'darwin' ? 'macos' : 'linux'}.zip`

  try {
    fs.mkdirSync(gltfpackDir, { recursive: true })
    console.log(`  Downloading gltfpack from meshoptimizer releases...`)
    const zipPath = path.join(gltfpackDir, 'gltfpack.zip')
    await downloadFile(meshoptUrl, zipPath)
    execSync(`unzip -o "${zipPath}" -d "${gltfpackDir}"`, { stdio: 'inherit' })
    fs.unlinkSync(zipPath)

    if (fs.existsSync(gltfpackPath)) {
      fs.chmodSync(gltfpackPath, 0o755)
      ok('gltfpack downloaded and installed.')
    } else {
      // The zip might contain a differently named binary
      const binaries = fs.readdirSync(gltfpackDir).filter(f => f.startsWith('gltfpack'))
      if (binaries.length > 0 && binaries[0] !== 'gltfpack') {
        fs.renameSync(path.join(gltfpackDir, binaries[0]), gltfpackPath)
        fs.chmodSync(gltfpackPath, 0o755)
        ok('gltfpack downloaded and installed.')
      } else {
        warn('gltfpack downloaded but binary not found at expected path.')
      }
    }
  } catch (err) {
    warn(`gltfpack download failed: ${err.message}. Download manually from https://github.com/zeux/meshoptimizer/releases`)
  }
}

// ── 9. 7z / bunzip2 (optional) ──
console.log('Decompression tools (optional):')
const sevenZip = which('7z')
const bunzip2 = which('bunzip2')
if (sevenZip) {
  ok(`7z found at ${sevenZip}`)
} else if (bunzip2) {
  ok(`bunzip2 found at ${bunzip2} (will be used as fallback)`)
} else {
  warn('Neither 7z nor bunzip2 found. Only needed if you provide .bsp.bz2 files. Install with: brew install p7zip')
}

// ── 10. Config file ──
console.log('Config:')
const configPath = path.join(repoRoot, 'scripts', 'convert-config.json')
const examplePath = path.join(repoRoot, 'scripts', 'convert-config.example.json')

if (fs.existsSync(configPath)) {
  ok(`Config exists: ${configPath}`)
} else if (fs.existsSync(examplePath)) {
  fs.copyFileSync(examplePath, configPath)
  ok(`Created config from example: ${configPath}`)
  warn('Edit scripts/convert-config.json with your local paths before converting.')
} else {
  warn('No config file or example found.')
}

// ── Summary ──
console.log('')
if (allGood) {
  console.log('\x1b[32mAll required dependencies found!\x1b[0m')
  console.log('')
  console.log('Next steps:')
  console.log('  1. Edit scripts/convert-config.json with your local paths')
  console.log('  2. Run a test conversion:')
  console.log('     node scripts/convert-map.mjs --map jump_beef --bsp-path ./jump_beef.bsp --skip-skybox')
} else {
  console.log(`\x1b[31m${problems.length} issue(s) found:\x1b[0m`)
  for (const problem of problems) {
    console.log(`  - ${problem}`)
  }
  console.log('')
  console.log('Fix the above issues and run this script again.')
}

console.log('')
