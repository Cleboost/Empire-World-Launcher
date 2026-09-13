{ pkgs ? import <nixpkgs> {} }:

let
  electronLibs = with pkgs; [
    gtk3
    glib
    nss
    nspr
    alsa-lib
    libdrm
    libxkbcommon
    libGL
    mesa
    expat
    dbus
    at-spi2-core
    cups
    libx11
    libxcomposite
    libxdamage
    libxext
    libxfixes
    libxrandr
    libxcb
    pango
    cairo
    atk
    at-spi2-atk
    libudev-zero
    libgbm
  ];
in

pkgs.mkShell {
  buildInputs = [ pkgs.bun ] ++ electronLibs;

  shellHook = ''
    export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath electronLibs}"
  '';
}
