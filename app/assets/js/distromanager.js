const path = require('path')
const fs = require('fs')
const { DistributionAPI } = require('helios-core/common')

const ConfigManager = require('./configmanager')

const REMOTE_DISTRO = 'https://cleboost.github.io/Empire-World-Launcher/distribution.json'
const localDistro = path.join(__dirname, '../../../distro/distribution.json')

// Old WesterosCraft url.
// exports.REMOTE_DISTRO_URL = 'http://mc.westeroscraft.com/WesterosCraftLauncher/distribution.json'
exports.REMOTE_DISTRO_URL = (
    process.env.EWL_LOCAL_DISTRO === '1' && fs.existsSync(localDistro)
) ? `file://${localDistro}` : REMOTE_DISTRO

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

exports.DistroAPI = api