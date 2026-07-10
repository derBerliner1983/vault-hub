#!/usr/bin/env bash
# Uninstall-Hook des Virenschutz-Plugins: deaktiviert die ClamAV-Dienste, die
# über Vault-Hub aktiviert wurden. Die Pakete selbst bleiben erhalten (sie
# können beim vollständigen Reset mit `deinstall.sh --reset-packages` entfernt
# werden) – so wird nichts überraschend gelöscht.
set -uo pipefail
run() { if [ "$(id -u)" = "0" ]; then "$@"; else sudo -n "$@"; fi; }

for unit in clamav-daemon clamav-freshclam; do
  run systemctl disable --now "$unit" 2>/dev/null || true
done
echo "[antivirus] ClamAV-Dienste deaktiviert (Pakete bleiben erhalten)."
