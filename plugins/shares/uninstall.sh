#!/usr/bin/env bash
# Uninstall-Hook des SMB-Freigaben-Plugins: nimmt die von Vault-Hub gesetzten
# Samba-Änderungen zurück (getaggter Block in smb.conf + UFW-Regeln). Läuft beim
# Deinstallieren des Plugins im Store und beim vollständigen deinstall.sh.
set -uo pipefail

CONF="/etc/samba/smb.conf"
BEGIN="# >>> vault-hub managed shares >>>"
END="# <<< vault-hub managed shares <<<"

run() { if [ "$(id -u)" = "0" ]; then "$@"; else sudo -n "$@"; fi; }

# 1) Getaggten Block aus smb.conf entfernen
if [ -f "$CONF" ] && run cat "$CONF" 2>/dev/null | grep -qF "$BEGIN"; then
  TMP="$(mktemp)"
  run cat "$CONF" 2>/dev/null | awk -v b="$BEGIN" -v e="$END" '
    $0==b {skip=1} skip==0 {print} $0==e {skip=0}
  ' > "$TMP"
  run cp "$TMP" "$CONF"
  rm -f "$TMP"
  # Wenn keine [Sektionen] mehr außer global → Samba stoppen, sonst neu laden
  if run grep -qE '^\[[^]]+\]' "$CONF" 2>/dev/null && [ "$(run grep -cE '^\[[^]]+\]' "$CONF" 2>/dev/null)" -gt 1 ]; then
    run systemctl reload smbd 2>/dev/null || run systemctl restart smbd 2>/dev/null || true
  else
    run systemctl stop smbd nmbd 2>/dev/null || run systemctl stop smbd 2>/dev/null || true
  fi
  echo "[shares] smb.conf-Block entfernt."
fi

# 2) UFW-Regeln mit vault-hub-samba-Marker löschen
if command -v ufw >/dev/null 2>&1 && run ufw status 2>/dev/null | grep -q "Status: active"; then
  for _ in $(seq 1 60); do
    line="$(run ufw status numbered 2>/dev/null | grep 'vault-hub-samba' | head -1)"
    [ -n "$line" ] || break
    num="$(echo "$line" | sed -nE 's/^\[\s*([0-9]+)\].*/\1/p')"
    [ -n "$num" ] || break
    run ufw --force delete "$num" >/dev/null 2>&1 || break
  done
  echo "[shares] UFW-Samba-Regeln entfernt."
fi
