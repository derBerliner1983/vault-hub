#!/usr/bin/env bash
# Vault-Hub – Deinstallation / Reset auf den Stand vor der Installation.
#
#   sudo bash deinstall.sh                 Kern entfernen, Daten behalten
#   sudo bash deinstall.sh --purge         zusätzlich Daten/DB/Plugins löschen
#   sudo bash deinstall.sh --purge --reset-packages
#                                          zusätzlich per App installierte Pakete entfernen
#   sudo bash deinstall.sh --purge --reset-packages --reset-users --yes
#                                          vollständiger Reset, ohne Rückfragen
#
# Es werden NUR Dinge angefasst, die Vault-Hub selbst angelegt/geändert hat.
# Änderungen, die du über Terminal/SSH gemacht hast, bleiben unberührt
# (sie werden bewusst nicht protokolliert). Alle über die App gemachten
# Systemänderungen stehen im Audit-Log und werden vor dem Löschen als Report
# gesichert.
set -uo pipefail

APP_NAME="Vault-Hub"
INSTALL_DIR="/opt/vault-hub"
DATA_DIR="/var/lib/vault-hub"
SERVICE_USER="vault-hub"
SERVICE_NAME="vault-hub"
PLUGINS_DIR="$DATA_DIR/plugins"
DB="$DATA_DIR/vault-hub.db"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERR]${NC} $*"; exit 1; }

[ "$(id -u)" = "0" ] || error "Bitte mit sudo/root ausführen: sudo bash deinstall.sh"

PURGE=""; YES=""; RESET_PACKAGES=""; RESET_USERS=""
for a in "$@"; do
  case "$a" in
    --purge) PURGE=1 ;;
    --yes|-y) YES=1 ;;
    --reset-packages) RESET_PACKAGES=1 ;;
    --reset-users) RESET_USERS=1 ;;
    *) warn "Unbekannte Option: $a" ;;
  esac
done

confirm() { # $1 = Frage
  [ -n "$YES" ] && return 0
  [ -t 0 ] || return 1
  read -rp "$1 [j/N]: " a; [ "$a" = "j" ] || [ "$a" = "J" ] || [ "$a" = "y" ] || [ "$a" = "Y" ]
}

info "=== $APP_NAME Deinstallation ==="

# ── 1) Audit-Report sichern (was hat die App am System geändert?) ──────────────
REPORT="/var/log/vault-hub-uninstall-$(date +%Y%m%d-%H%M%S).txt"
touch "$REPORT" 2>/dev/null || REPORT="$PWD/vault-hub-uninstall-$(date +%Y%m%d-%H%M%S).txt"
APP_PKGS=""; APP_USERS=""
{
  echo "Vault-Hub Deinstallations-Report – $(date)"
  echo "======================================================================"
} > "$REPORT"

if [ -f "$DB" ] && command -v sqlite3 >/dev/null 2>&1; then
  {
    echo
    echo "Protokoll aller über Vault-Hub gemachten Aktionen (Audit-Log):"
    echo "----------------------------------------------------------------------"
    sqlite3 -separator '  |  ' "$DB" "SELECT created_at, action, COALESCE(target,'') FROM audit_log ORDER BY id;" 2>/dev/null
  } >> "$REPORT"
  # Über die App installierte Pakete + angelegte Linux-Benutzer sammeln
  APP_PKGS=$(sqlite3 "$DB" "SELECT target FROM audit_log WHERE action IN ('package.install','system.package.install') AND target IS NOT NULL;" 2>/dev/null | tr ',' '\n' | sort -u | tr '\n' ' ')
  if [ -n "$(sqlite3 "$DB" "SELECT 1 FROM audit_log WHERE action='antivirus.install' LIMIT 1;" 2>/dev/null)" ]; then
    APP_PKGS="$APP_PKGS clamav clamav-daemon"
  fi
  APP_USERS=$(sqlite3 "$DB" "SELECT target FROM audit_log WHERE action='linuxuser.create';" 2>/dev/null | sort -u | tr '\n' ' ')
  info "Audit-Report gesichert: $REPORT"
elif [ -f "$DB" ]; then
  echo "(sqlite3 nicht installiert – Audit-Log konnte nicht ausgelesen werden.)" >> "$REPORT"
  warn "sqlite3 fehlt – für den detaillierten Report: apt install sqlite3"
else
  echo "(Keine Datenbank gefunden – nichts zu protokollieren.)" >> "$REPORT"
fi

# ── 2) Plugin-Uninstall-Hooks (Plugins nehmen eigene Systemänderungen zurück) ──
if [ -d "$PLUGINS_DIR" ]; then
  for d in "$PLUGINS_DIR"/*/; do
    [ -f "${d}uninstall.sh" ] || continue
    info "Plugin-Uninstall: $(basename "$d")"
    bash "${d}uninstall.sh" 2>/dev/null || warn "  uninstall.sh von $(basename "$d") meldete einen Fehler (übersprungen)."
  done
fi

# ── 3) Von Vault-Hub gesetzte UFW-Regeln entfernen (getaggt) ───────────────────
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  for _ in $(seq 1 60); do
    line=$(ufw status numbered 2>/dev/null | grep 'vault-hub' | head -1)
    [ -n "$line" ] || break
    num=$(echo "$line" | sed -nE 's/^\[\s*([0-9]+)\].*/\1/p')
    [ -n "$num" ] || break
    ufw --force delete "$num" >/dev/null 2>&1 || break
  done
  info "Vault-Hub-Firewallregeln entfernt."
fi

# ── 4) Kern entfernen (Dienste, Caddy, sudoers, Programm, Benutzer) ────────────
systemctl stop  "$SERVICE_NAME" 2>/dev/null || true
systemctl disable "$SERVICE_NAME" 2>/dev/null || true
rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl stop  vault-hub-voice 2>/dev/null || true
systemctl disable vault-hub-voice 2>/dev/null || true
rm -f "/etc/systemd/system/vault-hub-voice.service"
systemctl daemon-reload 2>/dev/null || true
info "systemd-Dienste entfernt."

CADDYFILE="/etc/caddy/Caddyfile"
if [ -f "$CADDYFILE" ] && grep -q "vault-hub-base" "$CADDYFILE" 2>/dev/null; then
  rm -f "$CADDYFILE"
  systemctl reload caddy 2>/dev/null || systemctl restart caddy 2>/dev/null || true
  info "Caddy-Konfiguration entfernt."
fi

rm -f /etc/sudoers.d/vault-hub && info "sudoers-Allowlist entfernt."
rm -rf "$INSTALL_DIR" && info "Programmverzeichnis $INSTALL_DIR gelöscht."
userdel "$SERVICE_USER" 2>/dev/null && info "Dienstbenutzer '$SERVICE_USER' entfernt." || true

# ── 5) Optional: per App installierte Pakete entfernen ─────────────────────────
APP_PKGS=$(echo "$APP_PKGS" | tr ' ' '\n' | sed '/^$/d' | sort -u | tr '\n' ' ')
if [ -n "$RESET_PACKAGES" ] && [ -n "${APP_PKGS// /}" ]; then
  warn "Über Vault-Hub installierte Pakete: $APP_PKGS"
  if confirm "Diese Pakete jetzt entfernen (apt-get purge)?"; then
    DEBIAN_FRONTEND=noninteractive apt-get purge -y $APP_PKGS 2>/dev/null || warn "Einige Pakete ließen sich nicht entfernen."
    apt-get autoremove -y 2>/dev/null || true
    info "App-Pakete entfernt."
  else
    info "Pakete behalten. Liste steht im Report: $REPORT"
  fi
elif [ -n "${APP_PKGS// /}" ]; then
  info "Per App installierte Pakete (nicht entfernt, siehe Report): $APP_PKGS"
  info "  Mit entfernen: sudo bash deinstall.sh --purge --reset-packages"
fi

# ── 6) Optional: per App angelegte Linux-Benutzer entfernen (destruktiv) ───────
if [ -n "$RESET_USERS" ] && [ -n "${APP_USERS// /}" ]; then
  for u in $APP_USERS; do
    case "$u" in root|vault-hub|"") continue ;; esac
    if confirm "Linux-Benutzer '$u' inkl. Home-Verzeichnis löschen?"; then
      userdel -r "$u" 2>/dev/null && info "Benutzer '$u' entfernt." || warn "  '$u' ließ sich nicht entfernen."
    fi
  done
elif [ -n "${APP_USERS// /}" ]; then
  info "Per App angelegte Linux-Benutzer (nicht entfernt, siehe Report): $APP_USERS"
fi

# ── 7) Daten löschen (nur bei --purge; Report liegt außerhalb von DATA_DIR) ────
if [ -n "$PURGE" ]; then
  rm -rf "$DATA_DIR"
  info "Daten unter $DATA_DIR gelöscht (DB, Plugins, Einstellungen)."
else
  info "Daten unter $DATA_DIR bleiben erhalten."
  info "  Alles löschen: sudo bash deinstall.sh --purge"
fi

echo
info "=== Fertig – $APP_NAME wurde entfernt. ==="
info "Report mit allen App-Systemänderungen: $REPORT"
info "Nicht angetastet: alles, was du direkt über Terminal/SSH gemacht hast."
