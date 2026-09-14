#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getMojangOS, isLibraryCompatible } from 'helios-core/common'

const outFile = process.argv[2]
if (!outFile) {
  console.error('Usage: build-neoforge-cp.mjs <output-file>')
  process.exit(1)
}

const root = join(import.meta.dir, '..')
const common = join(process.env.HOME, '.empireworldlauncher/common')
const libPath = join(common, 'libraries')
const vanilla = JSON.parse(readFileSync(join(common, 'versions/1.21.1/1.21.1.json'), 'utf8'))
const distro = JSON.parse(readFileSync(join(root, 'distro/distribution.json'), 'utf8'))
const loader = distro.servers[0].modules.find(m => m.type === 'ForgeHosted')

function mavenBase(name) {
  return name.split(':').slice(0, 3).join(':')
}

function libPathFromName(name) {
  const parts = name.split(':')
  const [group, artifact, version] = parts
  if (parts.length > 3) {
    const classifier = parts[3]
    const ext = classifier.includes('.') ? classifier.split('.').pop() : 'jar'
    const fileVersion = classifier.includes('.') ? version : `${version}-${classifier}`
    return join(libPath, group.replace(/\./g, '/'), artifact, version, `${artifact}-${fileVersion}.${ext}`)
  }
  return join(libPath, group.replace(/\./g, '/'), artifact, version, `${artifact}-${version}.jar`)
}

const mojang = {}
for (const lib of vanilla.libraries) {
  if (!isLibraryCompatible(lib.rules, lib.natives)) continue
  if (lib.downloads?.artifact) {
    mojang[mavenBase(lib.name)] = join(libPath, lib.downloads.artifact.path)
  }
  if (lib.downloads?.classifiers && lib.natives) {
    const nativeKey = lib.natives[getMojangOS()]?.replace('${arch}', process.arch.replace('x', ''))
    const nativeArtifact = nativeKey ? lib.downloads.classifiers[nativeKey] : null
    if (nativeArtifact?.path) {
      mojang[`${mavenBase(lib.name)}:natives`] = join(libPath, nativeArtifact.path)
    }
  }
}

const mojangCp = {}
for (const [k, v] of Object.entries(mojang)) {
  if (!k.endsWith(':natives')) {
    mojangCp[k] = v
  }
}

const BOOTSTRAP_CP_SKIP = new Set([
  'org.openjdk.nashorn:nashorn-core',
  'net.fabricmc:sponge-mixin'
])

function mavenCoordsFromName(name) {
  const parts = name.split(':')
  return `${parts[0]}:${parts[1]}`
}

const serv = {}
function walk(mdl) {
  if (mdl.type === 'ForgeHosted') {
    serv[mavenBase(mdl.id)] = join(libPath, 'net/neoforged/neoforge/21.1.250/neoforge-21.1.250.jar')
  }
  for (const sm of mdl.subModules ?? []) {
    if (sm.type === 'Library' && (sm.classpath ?? true)) {
      const coords = mavenCoordsFromName(sm.name)
      if (!BOOTSTRAP_CP_SKIP.has(coords)) {
        serv[mavenBase(sm.id)] = libPathFromName(sm.name)
      }
    }
    walk(sm)
  }
}
walk(loader)

writeFileSync(outFile, Object.values({ ...serv, ...mojangCp }).join('\n'))
