#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'

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
  const [group, artifact, version] = name.split(':')
  return join(libPath, group.replace(/\./g, '/'), artifact, version, `${artifact}-${version}.jar`)
}

const mojang = {}
for (const lib of vanilla.libraries) {
  if (!lib.downloads?.artifact) continue
  mojang[mavenBase(lib.name)] = join(libPath, lib.downloads.artifact.path)
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

writeFileSync(outFile, Object.values({ ...serv, ...mojang }).join('\n'))
