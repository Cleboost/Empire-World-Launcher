#!/usr/bin/env bash
# Quick NeoForge bootstrap smoke test (no Electron UI).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMMON="${HOME}/.empireworldlauncher/common"
GAME="${HOME}/.empireworldlauncher/instances/EmpireWorld-S4"
LIB="${COMMON}/libraries"
MC="1.21.1"
NATIVES="$(mktemp -d /tmp/ewl-natives-XXXXXX)"
CPFILE="$(mktemp /tmp/ewl-cp-XXXXXX.txt)"

cleanup() { rm -rf "$NATIVES" "$CPFILE"; }
trap cleanup EXIT

PRISM_CLIENT="${LIB}/com/mojang/minecraft/${MC}/minecraft-${MC}-client.jar"
VANILLA_JAR="${COMMON}/versions/${MC}/${MC}.jar"
if [[ -f "$VANILLA_JAR" && ! -e "$PRISM_CLIENT" ]]; then
  mkdir -p "$(dirname "$PRISM_CLIENT")"
  ln -sf "$VANILLA_JAR" "$PRISM_CLIENT"
fi

bun "$ROOT/scripts/build-neoforge-cp.mjs" "$CPFILE"
# Full classpath launch (Helios default), classpath:false entries already excluded.
CP="$(tr '\n' ':' < "$CPFILE")"
MAIN="$(bun -e "console.log(JSON.parse(await Bun.file('$ROOT/distro/loader/neoforge-21.1.250.json').text()).mainClass)")"
echo "Main class: $MAIN"
echo "Classpath entries: $(wc -l < "$CPFILE")"

JAVA="${JAVA_HOME:-}/bin/java"
if [[ ! -x "$JAVA" ]]; then
  JAVA="$(command -v java)"
fi

JVM_ARGS=(
  "-Djava.library.path=${NATIVES}"
  "-Djna.tmpdir=${NATIVES}"
  "-Dorg.lwjgl.system.SharedLibraryExtractPath=${NATIVES}"
  "-Dio.netty.native.workdir=${NATIVES}"
  "-Dminecraft.launcher.brand=Empire-World-Launcher"
  "-Dminecraft.launcher.version=0.0.3-test"
  "-DignoreList=bootstraplauncher,securejarhandler,asm-commons,asm-util,asm-analysis,asm-tree,asm,JarJarFileSystems,client-extra,fmlcore,javafmllanguage,lowcodelanguage,mclanguage,neoforge-"
  "-DmergeModules=jna-5.10.0.jar,jna-platform-5.10.0.jar"
  "-Dfml.earlyprogress=false"
  "-Dfml.earlyWindowControl=false"
  "-DlibraryDirectory=${LIB}"
  "--add-opens=java.base/java.lang.invoke=ALL-UNNAMED"
  "--add-opens=java.base/java.nio=ALL-UNNAMED"
  "--add-opens=java.base/sun.nio.ch=ALL-UNNAMED"
  "--add-opens=java.base/java.util.jar=ALL-UNNAMED"
  "--add-opens=java.base/java.lang=ALL-UNNAMED"
  "-Xmx2G"
  "-Xms1G"
)

echo "Running NeoForge smoke test..."
set +e
timeout 240 "$JAVA" -cp "$CP" "${JVM_ARGS[@]}" "$MAIN" \
  --username test \
  --version EmpireWorld-S4 \
  --gameDir "$GAME" \
  --assetsDir "${COMMON}/assets" \
  --assetIndex 17 \
  --uuid 530fa97a-357f-3c19-94d3-0c5c65c18fe8 \
  --accessToken test \
  --userType legacy \
  --versionType release \
  --launchTarget forgeclient \
  --fml.neoForgeVersion 21.1.250 \
  --fml.fmlVersion 4.0.44 \
  --fml.mcVersion 1.21.1 \
  --fml.neoFormVersion 20240808.144430 \
  "--fml.mavenRoots=${COMMON}/modstore" \
  --fml.modLists "${GAME}/forgeMods.list" 2>&1 | tee /tmp/ewl-bootstrap-test.log | tail -50
EXIT=${PIPESTATUS[0]}
set -e

if rg -q "Module org.objectweb.asm not found|Unsupported class file major version|InaccessibleObjectException|factory already defined|Unable to detect the forge installer|Unable to detect the Minecraft jar" /tmp/ewl-bootstrap-test.log; then
  echo "FAIL: known bootstrap error still present"
  exit 1
fi

if rg -q "ModLauncher running" /tmp/ewl-bootstrap-test.log; then
  echo "PASS: ModLauncher started (exit=$EXIT)"
  exit 0
fi

echo "FAIL: ModLauncher did not start (exit=$EXIT)"
tail -20 /tmp/ewl-bootstrap-test.log
exit 1
