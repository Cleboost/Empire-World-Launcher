#!/usr/bin/env bun
/**
 * Generate distro/ from a local Prism Launcher instance.
 *
 * Usage:
 *   bun scripts/generate-distro.mjs
 *   PRISM_INSTANCE=/path/to/instance bun scripts/generate-distro.mjs
 *   DISTRO_BASE_URL=https://cleboost.github.io/Empire-World-Launcher bun scripts/generate-distro.mjs
 */

import { createHash } from 'crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, join, relative } from 'path'

function emptyDirSync(dir) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}

const ROOT = join(import.meta.dir, '..')
const DISTRO_DIR = join(ROOT, 'distro')
const PRISM_INSTANCE = process.env.PRISM_INSTANCE
  ?? join(process.env.HOME, '.local/share/PrismLauncher/instances/Empire-World-s4')
const MINECRAFT_DIR = join(PRISM_INSTANCE, 'minecraft')
const PRISM_META = join(process.env.HOME, '.local/share/PrismLauncher/meta/net.neoforged/21.1.250.json')
const PRISM_LIBS = join(process.env.HOME, '.local/share/PrismLauncher/libraries')
const BASE_URL = (process.env.DISTRO_BASE_URL ?? 'https://cleboost.github.io/Empire-World-Launcher').replace(/\/$/, '')

const SERVER = {
  id: 'EmpireWorld-S4',
  name: 'Empire World Saison 4',
  description: 'Serveur survival moddé Empire World — Saison 4',
  version: '1.0.0',
  address: process.env.SERVER_ADDRESS ?? 'empire-world.camply.dev',
  minecraftVersion: '1.21.1',
  neoforgeVersion: '21.1.250'
}

/** Mod filenames treated as optional client-only toggles in Helios. */
const OPTIONAL_MODS = new Set([
  'entityculling-neoforge-1.10.5-mc1.21.1.jar',
  'ImmediatelyFast-NeoForge-1.6.13+1.21.1.jar',
  'sodium-neoforge-0.8.13+mc1.21.1.jar',
  'fullbrightnesstoggle-1.21.1-4.4.jar',
  'MouseTweaks-neoforge-mc1.21-2.26.1.jar',
  'jei-1.21.1-neoforge-19.51.0.418.jar',
  'jei_plus_plus-1.0.4-1.21.1.jar',
  'sounds-2.4.22+lts+1.21.1-neoforge.jar',
  'more_sounds-1.21.x-0.3.0-beta.jar',
  'mru-1.0.19+LTS+1.21.1+neoforge.jar',
  'creategoggles-1.21.1-6.1.1-[NEOFORGE].jar',
  'FallingTree-1.21.1-1.21.1.11.jar'
])

/** Skip duplicate or broken mod entries. */
const SKIP_MODS = new Set([
  'TaCZ-1.21.1-NeoForge-1.1.8-hotfix-r4-optimized.jar'
])

function md5File(path) {
  const hash = createHash('md5')
  hash.update(readFileSync(path))
  return hash.digest('hex')
}

function toMavenId(filename) {
  const base = basename(filename, '.jar').replace(/\+/g, '_')
  return `local.empireworld:${base}:1.0.0`
}

function artifactFromFile(localPath, urlPath) {
  const stat = statSync(localPath)
  return {
    size: stat.size,
    MD5: md5File(localPath),
    url: `${BASE_URL}/${urlPath.replace(/^\//, '')}`
  }
}

function copyTree(srcDir, destDir, urlPrefix) {
  const modules = []
  if (!existsSync(srcDir)) {
    return modules
  }

  for (const file of walkFiles(srcDir)) {
    const rel = relative(srcDir, file).replace(/\\/g, '/')
    const dest = join(destDir, rel)
    mkdirSync(join(dest, '..'), { recursive: true })
    cpSync(file, dest)
    modules.push({
      id: `file.empireworld:${rel.replace(/[^a-zA-Z0-9._-]/g, '_')}:1.0.0`,
      name: rel,
      type: 'File',
      artifact: {
        ...artifactFromFile(dest, `${urlPrefix}/${rel}`),
        path: rel
      }
    })
  }

  return modules
}

function walkFiles(dir, relBase = '') {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      continue
    }
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name
    if (shouldSkipConfigRelPath(rel)) {
      continue
    }
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, rel))
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}

/** User-specific or volatile files that must not ship in the distro. */
function shouldSkipConfigRelPath(relPath) {
  const rel = relPath.replace(/\\/g, '/')
  if (rel.startsWith('jei/world/')) {
    return true
  }
  if (rel.endsWith('.export-state.json')) {
    return true
  }
  return false
}

function libraryPathFromName(name) {
  const parts = name.split(':')
  if (parts.length < 3) {
    return null
  }
  const [group, artifact, version] = parts
  const classifier = parts[3] ?? 'jar'
  const ext = classifier.includes('.') ? classifier.split('.').pop() : 'jar'
  const fileVersion = parts[3] && !classifier.includes('.') ? `${version}-${classifier}` : version
  return join(PRISM_LIBS, group.replace(/\./g, '/'), artifact, version, `${artifact}-${fileVersion}.${ext}`)
}

/** Nashorn on legacy -cp breaks JPMS bootstrap (requires org.objectweb.asm as module). */
const BOOT_CLASSPATH_SKIP = new Set([
  'org.openjdk.nashorn:nashorn-core'
])

function buildLoaderModules() {
  const neoforgeMeta = JSON.parse(readFileSync(PRISM_META, 'utf8'))
  const runtimeLibraries = neoforgeMeta.libraries ?? []
  const mavenFiles = neoforgeMeta.mavenFiles ?? []
  const universal = [...runtimeLibraries, ...mavenFiles].find(l => l.name === `net.neoforged:neoforge:${SERVER.neoforgeVersion}:universal`)
  if (!universal) {
    throw new Error('NeoForge universal library not found in Prism meta.')
  }

  const libraryModules = []
  for (const lib of runtimeLibraries) {
    if (lib.name.startsWith('net.neoforged:neoforge:21.1.250:installer')) {
      continue
    }
    if (lib.name === 'net.neoforged:neoforge:21.1.250:universal') {
      continue
    }

    const artifact = lib.downloads?.artifact
    if (!artifact?.url) {
      continue
    }

    const localPath = artifact.path
      ? join(PRISM_LIBS, artifact.path)
      : libraryPathFromName(lib.name)

    if (!existsSync(localPath)) {
      console.warn(`WARN missing library on disk, using remote URL only: ${lib.name}`)
    }

    const nameParts = lib.name.split(':')
    const mavenId = nameParts.length > 3
      ? `${nameParts.slice(0, 3).join(':')}@${nameParts[3]}`
      : nameParts.slice(0, 3).join(':')

    const mavenCoords = `${nameParts[0]}:${nameParts[1]}`

    libraryModules.push({
      id: mavenId,
      name: lib.name,
      type: 'Library',
      ...(BOOT_CLASSPATH_SKIP.has(mavenCoords) ? { classpath: false } : {}),
      artifact: {
        size: artifact.size,
        MD5: existsSync(localPath) ? md5File(localPath) : artifact.sha1,
        url: artifact.url
      }
    })
  }

  const installer = mavenFiles.find(l => l.name === `net.neoforged:neoforge:${SERVER.neoforgeVersion}:installer`)
  if (installer?.downloads?.artifact?.url) {
    const nameParts = installer.name.split(':')
    const mavenId = `${nameParts.slice(0, 3).join(':')}@${nameParts[3]}`
    const artifact = installer.downloads.artifact
    const localPath = join(PRISM_LIBS, 'net/neoforged/neoforge/21.1.250/neoforge-21.1.250-installer.jar')
    libraryModules.push({
      id: mavenId,
      name: installer.name,
      type: 'Library',
      classpath: false,
      artifact: {
        size: artifact.size,
        MD5: existsSync(localPath) ? md5File(localPath) : artifact.sha1,
        url: artifact.url
      }
    })
  }

  const versionManifestPath = join(DISTRO_DIR, 'loader', 'neoforge-21.1.250.json')
  mkdirSync(join(versionManifestPath, '..'), { recursive: true })

  const neoforgeJvmOpens = [
    '--add-opens=java.base/java.lang.invoke=ALL-UNNAMED',
    '--add-opens=java.base/java.nio=ALL-UNNAMED',
    '--add-opens=java.base/sun.nio.ch=ALL-UNNAMED',
    '--add-opens=java.base/java.util.jar=ALL-UNNAMED',
    '--add-opens=java.base/java.lang=ALL-UNNAMED'
  ]

  const versionManifest = {
    id: SERVER.neoforgeVersion,
    mainClass: 'io.github.zekerzhayard.forgewrapper.installer.Main',
    arguments: {
      jvm: [
        '-Djava.library.path=${natives_directory}',
        '-Djna.tmpdir=${natives_directory}',
        '-Dorg.lwjgl.system.SharedLibraryExtractPath=${natives_directory}',
        '-Dio.netty.native.workdir=${natives_directory}',
        '-Dminecraft.launcher.brand=${launcher_name}',
        '-Dminecraft.launcher.version=${launcher_version}',
        '-DignoreList=bootstraplauncher,securejarhandler,asm-commons,asm-util,asm-analysis,asm-tree,asm,JarJarFileSystems,client-extra,fmlcore,javafmllanguage,lowcodelanguage,mclanguage,neoforge-',
        '-DmergeModules=jna-5.10.0.jar,jna-platform-5.10.0.jar',
        '-Dfml.earlyprogress=false',
        '-Dfml.earlyWindowControl=false',
        '-DlibraryDirectory=${library_directory}',
        ...neoforgeJvmOpens
      ],
      game: [
        '--launchTarget', 'forgeclient',
        '--fml.neoForgeVersion', SERVER.neoforgeVersion,
        '--fml.fmlVersion', '4.0.44',
        '--fml.mcVersion', SERVER.minecraftVersion,
        '--fml.neoFormVersion', '20240808.144430'
      ]
    }
  }

  writeFileSync(versionManifestPath, JSON.stringify(versionManifest, null, 2))

  const universalLocal = join(PRISM_LIBS, 'net/neoforged/neoforge/21.1.250/neoforge-21.1.250-universal.jar')

  return {
    id: `net.neoforged:neoforge:${SERVER.neoforgeVersion}`,
    name: `NeoForge ${SERVER.neoforgeVersion}`,
    type: 'ForgeHosted',
    artifact: {
      size: universal.downloads.artifact.size,
      MD5: md5File(universalLocal),
      url: universal.downloads.artifact.url
    },
    subModules: [
      {
        id: `neoforge-${SERVER.neoforgeVersion}-manifest`,
        name: 'NeoForge Version Manifest',
        type: 'VersionManifest',
        artifact: artifactFromFile(versionManifestPath, 'loader/neoforge-21.1.250.json')
      },
      ...libraryModules
    ]
  }
}

function buildModModules() {
  const modsSrc = join(MINECRAFT_DIR, 'mods')
  const modsDest = join(DISTRO_DIR, 'mods')
  emptyDirSync(modsDest)

  const modules = []
  for (const file of readdirSync(modsSrc).filter(f => f.endsWith('.jar')).sort()) {
    if (SKIP_MODS.has(file)) {
      console.log(`skip mod: ${file}`)
      continue
    }

    const src = join(modsSrc, file)
    const dest = join(modsDest, file)
    cpSync(src, dest)

    const mod = {
      id: toMavenId(file),
      name: basename(file, '.jar'),
      type: 'ForgeMod',
      artifact: artifactFromFile(dest, `mods/${file}`)
    }

    if (OPTIONAL_MODS.has(file)) {
      mod.required = { value: false, def: true }
    }

    modules.push(mod)
  }

  return modules
}

function main() {
  if (!existsSync(MINECRAFT_DIR)) {
    throw new Error(`Prism instance not found: ${PRISM_INSTANCE}`)
  }

  console.log(`Generating distro from ${PRISM_INSTANCE}`)
  console.log(`Base URL: ${BASE_URL}`)

  emptyDirSync(DISTRO_DIR)
  mkdirSync(DISTRO_DIR, { recursive: true })

  cpSync(join(MINECRAFT_DIR, 'icon.png'), join(DISTRO_DIR, 'icon.png'))

  const fileModules = []
  const options = join(MINECRAFT_DIR, 'options.txt')
  if (existsSync(options)) {
    const dest = join(DISTRO_DIR, 'files', 'options.txt')
    mkdirSync(join(dest, '..'), { recursive: true })
    cpSync(options, dest)
    fileModules.push({
      id: 'file.empireworld:options.txt:1.0.0',
      name: 'Default Options',
      type: 'File',
      artifact: {
        ...artifactFromFile(dest, 'files/options.txt'),
        path: 'options.txt'
      }
    })
  }

  fileModules.push(...copyTree(join(MINECRAFT_DIR, 'config'), join(DISTRO_DIR, 'config'), 'config'))
  fileModules.push(...copyTree(join(MINECRAFT_DIR, 'tacz'), join(DISTRO_DIR, 'tacz'), 'tacz'))
  fileModules.push(...copyTree(join(MINECRAFT_DIR, 'defaultconfigs'), join(DISTRO_DIR, 'defaultconfigs'), 'defaultconfigs'))

  const distribution = {
    version: SERVER.version,
    rss: `${BASE_URL}/rss.xml`,
    discord: {
      clientId: '000000000000000000',
      smallImageText: 'Empire World',
      smallImageKey: 'empire-world'
    },
    servers: [
      {
        id: SERVER.id,
        name: SERVER.name,
        description: SERVER.description,
        icon: `${BASE_URL}/icon.png`,
        version: SERVER.version,
        address: SERVER.address,
        minecraftVersion: SERVER.minecraftVersion,
        mainServer: true,
        autoconnect: true,
        discord: {
          shortId: 'Saison 4',
          largeImageText: 'Empire World Saison 4',
          largeImageKey: 'empire-world'
        },
        modules: [
          buildLoaderModules(),
          ...buildModModules(),
          ...fileModules
        ]
      }
    ]
  }

  writeFileSync(join(DISTRO_DIR, 'distribution.json'), JSON.stringify(distribution, null, 2))
  writeFileSync(join(DISTRO_DIR, 'rss.xml'), `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Empire World</title><link>${BASE_URL}</link><description>Empire World Launcher news</description></channel></rss>`)

  console.log('Done.')
  console.log(`Optional client mods: ${OPTIONAL_MODS.size}`)
  console.log(`Output: ${DISTRO_DIR}`)
}

main()
