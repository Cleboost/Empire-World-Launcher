const { execFile } = require('child_process')
const { promisify } = require('util')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')
const {
    discoverBestJvmInstallation,
    validateSelectedJvm,
    ensureJavaDirIsRoot,
    javaExecFromRoot,
    rankApplicableJvms
} = require('helios-core/java')
const { LoggerUtil } = require('helios-core')
const ConfigManager = require('./configmanager')

const log = LoggerUtil.getLogger('JavaDiscovery')
const execFileAsync = promisify(execFile)

async function runCommand(command, args = [], options = {}) {
    try {
        const { stdout } = await execFileAsync(command, args, {
            timeout: 8000,
            encoding: 'utf8',
            ...options
        })
        return stdout.trim()
    } catch {
        return null
    }
}

function rootFromJavaBinary(execPath) {
    const normalized = execPath.replace(/\\/g, '/').toLowerCase()
    const markers = ['/bin/java', '/bin/javaw', '/bin/java.exe', '/bin/javaw.exe']
    for (const marker of markers) {
        const idx = normalized.indexOf(marker)
        if (idx > -1) {
            return execPath.slice(0, idx)
        }
    }
    return ensureJavaDirIsRoot(execPath)
}

async function resolveJavaRoot(candidate) {
    if (!candidate) {
        return null
    }

    let execPath = candidate
    try {
        execPath = await fs.realpath(execPath)
    } catch {
        return null
    }

    const root = rootFromJavaBinary(execPath)
    if (await fs.pathExists(javaExecFromRoot(root))) {
        return root
    }

    if (await fs.pathExists(javaExecFromRoot(execPath))) {
        return execPath
    }

    return null
}

async function addJavaBinaryCandidate(roots, candidate) {
    const root = await resolveJavaRoot(candidate)
    if (root) {
        roots.add(root)
    }
}

async function discoverFromPathEntries(roots) {
    const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
    for (const entry of pathEntries) {
        await addJavaBinaryCandidate(roots, path.join(entry, process.platform === 'win32' ? 'java.exe' : 'java'))
    }
}

async function discoverFromEnvVars(roots) {
    for (const key of ['JAVA_HOME', 'JRE_HOME', 'JDK_HOME', 'NIX_JAVA_HOME']) {
        const value = process.env[key]
        if (!value) {
            continue
        }
        await addJavaBinaryCandidate(roots, path.join(value, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))
        await addJavaBinaryCandidate(roots, value)
    }
}

async function discoverWindowsJavaRoots() {
    const roots = new Set()

    const whereOut = await runCommand(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'where java'])
    if (whereOut) {
        for (const line of whereOut.split(/\r?\n/)) {
            await addJavaBinaryCandidate(roots, line.trim())
        }
    }

    const programFiles = [
        process.env['ProgramFiles'],
        process.env['ProgramFiles(x86)'],
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : null
    ].filter(Boolean)

    const relativeDirs = [
        'Java',
        'Eclipse Adoptium',
        'Eclipse Foundation',
        'AdoptOpenJDK',
        'Amazon Corretto',
        'Microsoft',
        'Zulu',
        'BellSoft'
    ]

    for (const base of programFiles) {
        for (const relativeDir of relativeDirs) {
            const directory = path.join(base, relativeDir)
            if (!(await fs.pathExists(directory))) {
                continue
            }
            const entries = await fs.readdir(directory)
            for (const entry of entries) {
                await addJavaBinaryCandidate(roots, path.join(directory, entry))
            }
        }
    }

    if (process.env.USERPROFILE) {
        const scoopJava = path.join(process.env.USERPROFILE, 'scoop', 'apps')
        if (await fs.pathExists(scoopJava)) {
            const entries = await fs.readdir(scoopJava)
            for (const entry of entries) {
                if (entry.toLowerCase().includes('openjdk') || entry.toLowerCase().includes('java')) {
                    await addJavaBinaryCandidate(roots, path.join(scoopJava, entry, 'current'))
                }
            }
        }
    }

    return roots
}

async function discoverDarwinJavaRoots() {
    const roots = new Set()

    let javaHomeList = null
    try {
        const { stdout, stderr } = await execFileAsync('/usr/libexec/java_home', ['-V'], {
            timeout: 8000,
            encoding: 'utf8'
        })
        javaHomeList = `${stdout}\n${stderr}`.trim()
    } catch (err) {
        if (err.stdout || err.stderr) {
            javaHomeList = `${err.stdout || ''}\n${err.stderr || ''}`.trim()
        }
    }
    if (javaHomeList) {
        const matches = javaHomeList.matchAll(/-\s+`([^`]+)`/g)
        for (const match of matches) {
            await addJavaBinaryCandidate(roots, match[1])
        }
    }

    const currentJavaHome = await runCommand('/usr/libexec/java_home', [])
    if (currentJavaHome) {
        await addJavaBinaryCandidate(roots, currentJavaHome)
    }

    const homebrewRoots = ['/opt/homebrew/opt', '/usr/local/opt']
    for (const base of homebrewRoots) {
        if (!(await fs.pathExists(base))) {
            continue
        }
        const entries = await fs.readdir(base)
        for (const entry of entries) {
            if (!entry.toLowerCase().startsWith('openjdk')) {
                continue
            }
            await addJavaBinaryCandidate(roots, path.join(base, entry, 'libexec/openjdk.jdk/Contents/Home'))
        }
    }

    const sdkmanRoot = path.join(os.homedir(), '.sdkman/candidates/java')
    if (await fs.pathExists(sdkmanRoot)) {
        const entries = await fs.readdir(sdkmanRoot)
        for (const entry of entries) {
            if (entry === 'current') {
                continue
            }
            await addJavaBinaryCandidate(roots, path.join(sdkmanRoot, entry))
        }
    }

    return roots
}

async function discoverLinuxJavaRoots() {
    const roots = new Set()

    const whichOut = await runCommand('which', ['-a', 'java'])
    if (whichOut) {
        for (const line of whichOut.split('\n')) {
            await addJavaBinaryCandidate(roots, line.trim())
        }
    }

    const nixCandidates = [
        path.join(os.homedir(), '.nix-profile/bin/java'),
        '/run/current-system/sw/bin/java'
    ]

    if (process.env.USER) {
        nixCandidates.push(`/etc/profiles/per-user/${process.env.USER}/bin/java`)
    }

    for (const candidate of nixCandidates) {
        await addJavaBinaryCandidate(roots, candidate)
    }

    const nixRoots = [
        '/usr/lib/jvm',
        '/usr/local/lib/jvm',
        path.join(os.homedir(), '.local/share/JetBrains/JetBrainsRuntime')
    ]

    for (const directory of nixRoots) {
        if (!(await fs.pathExists(directory))) {
            continue
        }
        const entries = await fs.readdir(directory)
        for (const entry of entries) {
            await addJavaBinaryCandidate(roots, path.join(directory, entry))
        }
    }

    return roots
}

async function discoverExtendedJavaRoots() {
    const roots = new Set()

    await discoverFromEnvVars(roots)
    await discoverFromPathEntries(roots)

    switch (process.platform) {
        case 'win32':
            for (const root of await discoverWindowsJavaRoots()) {
                roots.add(root)
            }
            break
        case 'darwin':
            for (const root of await discoverDarwinJavaRoots()) {
                roots.add(root)
            }
            break
        case 'linux':
            for (const root of await discoverLinuxJavaRoots()) {
                roots.add(root)
            }
            break
        default:
            break
    }

    return [...roots]
}

async function discoverBestJvmInstallationEnhanced(dataDir, semverRange) {
    const extendedRoots = await discoverExtendedJavaRoots()
    log.info(`Extended Java scan found ${extendedRoots.length} candidate installation(s).`)

    const candidates = []
    const seenPaths = new Set()

    const pushCandidate = (details) => {
        if (details == null || seenPaths.has(details.path)) {
            return
        }
        seenPaths.add(details.path)
        candidates.push(details)
    }

    pushCandidate(await discoverBestJvmInstallation(dataDir, semverRange))

    for (const root of extendedRoots) {
        pushCandidate(await validateSelectedJvm(root, semverRange))
    }

    if (candidates.length === 0) {
        return null
    }

    rankApplicableJvms(candidates)
    const best = candidates[0]
    log.info(`Selected JVM ${best.semverStr} (${best.vendor}) at ${best.path}`)
    return best
}

async function resolveStoredOrDiscoverJava(dataDir, semverRange, storedExec) {
    if (storedExec && await fs.pathExists(storedExec)) {
        const storedDetails = await validateSelectedJvm(ensureJavaDirIsRoot(storedExec), semverRange)
        if (storedDetails != null) {
            return javaExecFromRoot(storedDetails.path)
        }
        log.info(`Stored Java executable is invalid, rescanning: ${storedExec}`)
    }

    const best = await discoverBestJvmInstallationEnhanced(dataDir, semverRange)
    return best != null ? javaExecFromRoot(best.path) : null
}

async function prefetchJavaExecutable(server) {
    if (server == null) {
        return
    }

    const serverId = ConfigManager.getSelectedServer()
    if (serverId == null) {
        return
    }

    const javaExec = await resolveStoredOrDiscoverJava(
        ConfigManager.getDataDirectory(),
        server.effectiveJavaOptions.supported,
        ConfigManager.getJavaExecutable(serverId)
    )

    if (javaExec == null) {
        return
    }

    if (ConfigManager.getJavaExecutable(serverId) !== javaExec) {
        ConfigManager.setJavaExecutable(serverId, javaExec)
        ConfigManager.save()
        log.info(`Auto-selected Java executable: ${javaExec}`)
    }
}

exports.discoverBestJvmInstallationEnhanced = discoverBestJvmInstallationEnhanced
exports.resolveStoredOrDiscoverJava = resolveStoredOrDiscoverJava
exports.prefetchJavaExecutable = prefetchJavaExecutable
