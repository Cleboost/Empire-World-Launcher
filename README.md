<p align="center"><img src="./app/assets/images/SealCircle.png" width="150px" height="150px" alt="Empire World"></p>

<h1 align="center">Empire World — Saison 4</h1>

<p align="center">Launcher officiel pour la Saison 4 d'Empire World, serveur Minecraft moddé en survie. Rejoins le serveur sans te soucier de Java, Forge ou des mods — on s'en occupe.</p>

## Features

* Full account management (Microsoft + Mojang)
* Automatic mod and asset management
* Automatic Java validation and installation
* News feed built into the launcher
* Server status and player count
* Automatic launcher updates

## Downloads

Installers are available on [GitHub Releases](https://github.com/Cleboost/Empire-World-Launcher/releases).

| Platform | File |
| -------- | ---- |
| Windows x64 | `Empire-World-Launcher-setup-VERSION.exe` |
| macOS x64 | `Empire-World-Launcher-setup-VERSION-x64.dmg` |
| macOS arm64 | `Empire-World-Launcher-setup-VERSION-arm64.dmg` |
| Linux x64 | `Empire-World-Launcher-setup-VERSION.AppImage` |

## Console

Open the developer console with:

```console
ctrl + shift + i
```

## Development

**System Requirements**

* [Bun][bun] v1.3+

**Clone and Install Dependencies**

```console
> git clone https://github.com/Cleboost/Empire-World-Launcher.git
> cd Empire-World-Launcher
> bun install
```

**Launch Application**

```console
> bun start
```

**Build Installers**

```console
> bun run dist
```

| Platform    | Command               |
| ----------- | --------------------- |
| Windows x64 | `bun run dist:win`    |
| macOS       | `bun run dist:mac`    |
| Linux x64   | `bun run dist:linux`  |

For Microsoft Authentication setup, see [docs/MicrosoftAuth.md](docs/MicrosoftAuth.md).

---

Based on [Helios Launcher](https://github.com/dscalzi/HeliosLauncher) by Daniel Scalzi.

[bun]: https://bun.sh/ 'Bun'
