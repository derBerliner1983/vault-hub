#!/usr/bin/env bash
# Vault-Hub – .deb package builder
# Usage: bash build-deb.sh
# Output: vault-hub_<version>_amd64.deb
set -e

VERSION="$(cat ./VERSION 2>/dev/null || echo '0.0.0')"
ARCH="${ARCH:-amd64}"
PACKAGE_NAME="vault-hub"
DEB_NAME="${PACKAGE_NAME}_${VERSION}_${ARCH}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERR]${NC} $*"; exit 1; }

command -v node &>/dev/null || error "Node.js nicht gefunden – bitte Node.js 20+ installieren"
NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
[ "$NODE_VER" -lt 20 ] && error "Node.js >= 20 erforderlich (aktuell: $(node -v))"

info "Baue Vault-Hub v${VERSION} als .deb-Paket..."

# ── Build frontend & backend ───────────────────────────────────
info "Frontend-Build..."
cd frontend && npm install --silent && npm run build && cd ..

info "Backend-Build..."
cd backend && npm install --silent --omit=dev && npm run build && cd ..

# ── Paket-Verzeichnisstruktur anlegen ────────────────────────
BUILD_DIR="$(mktemp -d)"
PKG_ROOT="${BUILD_DIR}/${DEB_NAME}"

mkdir -p \
  "${PKG_ROOT}/DEBIAN" \
  "${PKG_ROOT}/opt/vault-hub/backend" \
  "${PKG_ROOT}/opt/vault-hub/frontend" \
  "${PKG_ROOT}/etc/systemd/system" \
  "${PKG_ROOT}/etc/sudoers.d" \
  "${PKG_ROOT}/var/lib/vault-hub"

# ── Dateien kopieren ─────────────────────────────────────────
cp -r backend/dist           "${PKG_ROOT}/opt/vault-hub/backend/dist"
cp -r backend/node_modules   "${PKG_ROOT}/opt/vault-hub/backend/node_modules"
cp    backend/package.json   "${PKG_ROOT}/opt/vault-hub/backend/package.json"
cp -r frontend/dist          "${PKG_ROOT}/opt/vault-hub/frontend/dist"
cp    VERSION                "${PKG_ROOT}/opt/vault-hub/VERSION"

# ── DEBIAN/control ────────────────────────────────────────────
cat > "${PKG_ROOT}/DEBIAN/control" <<EOF
Package: ${PACKAGE_NAME}
Version: ${VERSION}
Architecture: ${ARCH}
Maintainer: Vault-Hub <noreply@github.com>
Depends: nodejs (>= 20)
Description: Vault-Hub Linux Server Management
 Web-basiertes Dashboard zur Verwaltung von Docker-Containern, VMs,
 Netzwerken, Backups, Sicherheit und mehr – direkt im Browser.
Section: web
Priority: optional
Installed-Size: $(du -sk "${PKG_ROOT}/opt" | cut -f1)
EOF

# ── Systemd-Service ────────────────────────────────────────────
cat > "${PKG_ROOT}/etc/systemd/system/vault-hub.service" <<EOF
[Unit]
Description=Vault-Hub – Linux Server Management
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=vault-hub
Group=docker
WorkingDirectory=/opt/vault-hub/backend
Environment=NODE_ENV=production
Environment=PORT=4200
Environment=DATA_DIR=/var/lib/vault-hub
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
EOF

# ── sudoers ────────────────────────────────────────────────────
cat > "${PKG_ROOT}/etc/sudoers.d/vault-hub" <<EOF
vault-hub ALL=(root) NOPASSWD: /usr/bin/apt-get, /usr/bin/apt, /usr/bin/dnf, /usr/bin/pacman, \\
  /usr/bin/systemctl, /usr/sbin/useradd, /usr/sbin/userdel, /usr/sbin/usermod, /usr/sbin/groupadd, \\
  /usr/bin/chpasswd, /usr/bin/smbpasswd, /usr/bin/cp, /usr/bin/tar, /usr/bin/mkdir, /usr/bin/rm, \\
  /usr/bin/virsh, /usr/bin/virt-install, /usr/bin/qemu-img, /usr/bin/tee, /bin/bash, \\
  /usr/sbin/smbcontrol, /usr/bin/caddy, /usr/sbin/nginx, /usr/bin/ufw, /usr/sbin/ufw, \\
  /usr/bin/sed, /usr/bin/chown, /usr/sbin/dpkg-reconfigure, /usr/bin/debconf-set-selections, \\
  /usr/bin/dpkg-reconfigure, /sbin/ufw, /usr/bin/freshclam, /usr/bin/clamscan, /usr/bin/clamdscan, \\
  /usr/bin/git, /usr/sbin/sysctl, /sbin/sysctl, /usr/sbin/reboot, /sbin/reboot
EOF
chmod 0440 "${PKG_ROOT}/etc/sudoers.d/vault-hub"

# ── postinst ──────────────────────────────────────────────────
cat > "${PKG_ROOT}/DEBIAN/postinst" <<'POSTINST'
#!/bin/bash
set -e
# Benutzer anlegen
if ! id vault-hub &>/dev/null; then
  useradd -r -s /bin/false -d /opt/vault-hub vault-hub
fi
getent group docker  >/dev/null && usermod -aG docker  vault-hub || true
getent group libvirt >/dev/null && usermod -aG libvirt vault-hub || true

chown -R vault-hub:vault-hub /opt/vault-hub /var/lib/vault-hub

systemctl daemon-reload
systemctl enable vault-hub
systemctl restart vault-hub

IP=$(hostname -I | awk '{print $1}')
echo ""
echo "✅ Vault-Hub installiert!"
echo "   Zugriff: http://${IP}:4200"
echo "   Login:   admin / admin"
echo "   ⚠ Bitte Passwort nach erstem Login ändern!"
echo ""
POSTINST
chmod 0755 "${PKG_ROOT}/DEBIAN/postinst"

# ── prerm ─────────────────────────────────────────────────────
cat > "${PKG_ROOT}/DEBIAN/prerm" <<'PRERM'
#!/bin/bash
systemctl stop vault-hub 2>/dev/null || true
systemctl disable vault-hub 2>/dev/null || true
PRERM
chmod 0755 "${PKG_ROOT}/DEBIAN/prerm"

# ── .deb bauen ────────────────────────────────────────────────
info "Erstelle ${DEB_NAME}.deb..."
dpkg-deb --build "${PKG_ROOT}" "${DEB_NAME}.deb" 2>/dev/null || \
  { command -v dpkg-deb &>/dev/null || error "dpkg-deb nicht gefunden – bitte 'apt install dpkg' installieren"; }

rm -rf "${BUILD_DIR}"

info ""
info "✅ Fertig: ${DEB_NAME}.deb"
info ""
info "Installation:"
info "  sudo dpkg -i ${DEB_NAME}.deb"
info "  sudo apt-get install -f   # Abhängigkeiten nachinstallieren falls nötig"
info ""
info "Deinstallation:"
info "  sudo dpkg -r ${PACKAGE_NAME}"
info "  # Daten unter /var/lib/vault-hub bleiben erhalten"
