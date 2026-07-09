# Vault-Hub – Konzept & Roadmap

> **Vault-Hub** – die Zentrale deines Linux-Servers. · `v0.7.6`

## Vision

Web-basiertes Verwaltungs-Dashboard für Linux-Server (headless).  
Kein Desktop nötig – alles per Browser vom PC, Handy oder Tablet.  
Designsprache: eigenes Design-System (Emerald-Akzent, Inter-Font, Hell/Dunkel, Glass-Effekte).

---

## Architektur

```
Browser (überall)
    │ HTTPS + WebSocket + SSE
    ▼
Vault-Hub Backend   ← läuft als systemd-Dienst auf dem Server
├── Fastify (Node.js/TypeScript)
├── JWT-Auth + bcrypt + 2FA (TOTP)
├── SQLite (Users, Audit-Log, Proxy-Hosts, Backup-Pläne, Alarm-Regeln,
│          firewall_disabled, firewall_ignored_ports, container_meta,
│          user_prefs (UI-Sortierung pro Benutzer), app_settings …)
├── Docker Engine API (dockerode) – Container, Images, Netzwerke
├── systeminformation – CPU, RAM, Disk, Netzwerk, GPU (NVIDIA + AMD/APU)
└── System-Befehle über sudoers-Allowlist
    ├── systemctl  (Dienste, Samba, Ollama, SSH …)
    ├── smbd / smbpasswd  (Samba + UFW-Lifecycle)
    ├── ufw  (Firewall-Regeln, Samba-LAN-Freigabe)
    ├── ss / ip   (lauschende Ports, aktive Verbindungen, LAN-Subnetz)
    ├── sysctl  (IPv6 an/aus – Standard nur IPv4)
    ├── caddy  (HTTPS-Proxy, interne CA)
    ├── virsh / qemu-img  (VMs + Snapshots)
    ├── ollama  (KI-Modelle, GGUF-Downloads)
    └── tar / rsync / clamav / apt / dnf
```

**Installation:** Ein einziges `bash install.sh` → systemd-Service aktiv.

---

## Design (Design-Tokens)

| Token | Hell | Dunkel |
|---|---|---|
| Hintergrund | `#F7F7F8` | `#1C1C1F` |
| Karten/Surface | `#FFFFFF` | `#26262B` |
| Text | `#0B0B0F` | `#F4F4F5` |
| **Akzent (Emerald)** | `#10B981` | `#34D399` |
| Warnung | `#D97706` | `#FBBF24` |
| Fehler | `#DC2626` | `#F87171` |

Sidebar: Glass-Effekt (`blur(24px) saturate(160%)`), 232px, collapsible.  
Buttons: Pill-Form (`border-radius: 999px`).  
Font: Inter.

---

## Feature-Module

### ✅ Phase 1 – MVP

| Modul | Status |
|---|---|
| Login (JWT, bcrypt, HttpOnly-Cookie) | ✅ |
| Container-Liste (Start/Stop/Restart/Delete/Logs) | ✅ |
| Container erstellen (Image, Ports, Env, Volumes, Kategorie) | ✅ |
| Update-Pull (neues Image holen) | ✅ |
| Audit-Log | ✅ |
| Hell/Dunkel-Theme, collapsible Sidebar | ✅ |
| 1-Klick Installation (install.sh + systemd) | ✅ |

### ✅ Phase 2 – Monitoring & Taskmanager

| Modul | Status |
|---|---|
| Dashboard (collapsible Panels) | ✅ |
| Prozessor-Panel: Gesamtlast + pro CPU-Kern + Verlaufsgraph | ✅ |
| System-Panel: RAM-Donut mit Aufteilung System/VM/Docker/Frei | ✅ |
| Disk-Donuts pro Mount, Netzwerk-Schnittstellen | ✅ |
| Taskmanager: Prozesse auflisten + beenden (TERM/KILL) | ✅ |
| Taskmanager: systemd-Dienste start/stop/restart/Autostart | ✅ |
| Automatisierung: Crontab anlegen/löschen (mit Presets) | ✅ |
| Automatisierung: Autostart (Dienste enable/disable) | ✅ |

### ✅ Phase 3 – Virtualisierung

| Modul | Status |
|---|---|
| VM-Liste mit Status, vCPU, RAM (libvirt/virsh) | ✅ |
| VM starten / herunterfahren / hart aus / neustarten | ✅ |
| VM erstellen (virt-install Wizard: RAM, CPU, Disk, ISO) | ✅ |
| VM-Snapshot erstellen | ✅ |
| VM-Autostart umschalten, VM löschen | ✅ |

### ✅ Phase 4 – Updates, Backup, SMB & Benutzer

| Feature | Status |
|---|---|
| System-Updates (apt/dnf/pacman: suchen + einspielen) | ✅ |
| Docker-Backup (Volumes via busybox) | ✅ |
| Verzeichnis-Backup (tar.gz) | ✅ |
| VM-Backup (qcow2 komprimiert) | ✅ |
| Backup Download / Löschen | ✅ |
| SMB-Freigaben (anlegen/löschen, smbd steuern, SMB-User) | ✅ |
| Benutzerverwaltung (Vault-Hub Logins + Linux-User, sudo) | ✅ |
| Rechte-Modell (sudoers-Allowlist via install.sh) | ✅ |

### ✅ Phase 5 – Automatisches HTTPS

| Feature | Status |
|---|---|
| Reverse-Proxy auf Caddy-Basis | ✅ |
| HTTPS pro Host per Schalter aktivieren/deaktivieren | ✅ |
| HTTPS für alle Hosts auf einmal | ✅ |
| Interne CA (`tls internal`) – automatische Zertifikate | ✅ |
| Root-CA Download | ✅ |
| Auto-Vorschläge aus laufenden Containern mit HTTP-Port | ✅ |

### ✅ Phase 6 – Einstellungen & Migration

| Feature | Status |
|---|---|
| Einstellungen-Seite, Passwort ändern | ✅ |
| System-Info + erkannte Module | ✅ |
| Migration Export/Import (DB + Zertifikate + SMB) als .tar.gz | ✅ |
| Import per Drag & Drop | ✅ |

### ✅ Phase 7 – Netzwerke, VLANs & Firewall

| Feature | Status |
|---|---|
| Docker-Netzwerke auflisten/erstellen/löschen | ✅ |
| VLANs via macvlan/ipvlan + Eltern-Schnittstelle + VLAN-ID | ✅ |
| Isolierte Netze (internal) | ✅ |
| Container verbinden mit fester IP + Aliassen | ✅ |
| Firewall (ufw): Regeln allow/deny/reject nach Port/IP | ✅ |

### ✅ Phase 8 – Sicherheits-Check & Härtung

| Feature | Status |
|---|---|
| Sicherheits-Scan mit Score (0–100) + Note | ✅ |
| SSH (Root-Login, Passwort-Auth), Firewall-Status | ✅ |
| Sicherheitsupdates, Auto-Updates, fail2ban, Reboot | ✅ |
| Konten ohne Passwort, mehrere UID-0, offene Ports | ✅ |
| Docker: privilegierte Container, docker.sock-Mounts | ✅ |
| Härtungs-Tipps + 1-Klick-Aktionen pro Fund | ✅ |

### ✅ Phase 9

| Feature | Status |
|---|---|
| Container „Update verfügbar"-Erkennung (Registry-Digest) + 1-Klick-Update | ✅ |
| VM-Netzwerke (libvirt: NAT/isoliert/Bridge + VLAN, VM anhängen) | ✅ |
| SSH ein-/ausschaltbar + 1-Klick-Härtung | ✅ |
| Virenschutz (ClamAV): installieren, Signaturen updaten, scannen | ✅ |
| Erweiterte Sicherheits-Checks (Standard-Passwort, AppArmor/SELinux, AV) | ✅ |
| 2FA (TOTP) für Logins | ✅ |
| Automatische Backup-Zeitpläne (Cron, Aufbewahrung) | ✅ |
| Benachrichtigungen (Webhook Discord/Slack + E-Mail, je Ereignis) | ✅ |
| App-Vorlagen / 1-Klick-Install (Nextcloud, Jellyfin, …) | ✅ |
| Versionsanzeige + Update-Prüfung gegen GitHub-Releases | ✅ |

### ✅ Phase 10 – Qualität & Betrieb

| Feature | Status |
|---|---|
| Container-Detailseite (Live-Logs-Polling, CPU/RAM-Sparkline, Env/Volumes/Ports) | ✅ |
| Bestätigungsdialoge bei Löschen | ✅ |
| Rate-Limiting auf Login (5 Versuche / 15 min per IP) | ✅ |
| Session-Timeout (2h Inaktivität → automatischer Logout) | ✅ |
| Audit-Log-Rotation (Einträge älter 90 Tage täglich gelöscht) | ✅ |
| Health-Endpunkt `GET /health` | ✅ |
| System-Dark-Mode als Standard | ✅ |
| Mobile-Optimierung (Sidebar als Drawer, Touch-Targets) | ✅ |
| `.deb`-Paket (`build-deb.sh`) | ✅ |

### ✅ Phase 11 – Alarme, E-Mail & Optimierung

| Feature | Status |
|---|---|
| SMTP-E-Mail-Versand (Server/Port/User/Passwort/SSL im UI, Test-Mail) | ✅ |
| Alarm-Regeln: vordefinierte Auffälligkeiten (SSH-Root, fail2ban, Risiko-Ports, Score) | ✅ |
| Eigene Schwellwert-Regeln (CPU/RAM/Disk über X % für Y Minuten) | ✅ |
| Empfänger pro Regel (mehrere E-Mail-Adressen) | ✅ |
| Hintergrund-Monitor (alle 60 s, Anti-Spam-Cooldown 1 h) | ✅ |
| Optimierungs-Panel im Dashboard | ✅ |
| Web-Terminal (xterm.js + WebSocket, node-pty mit `script`-Fallback) | ✅ |
| Echter RAM-Wert wie htop (aus /proc/meminfo) | ✅ |
| HTTPS überall (Caddy: HTTP→HTTPS-Redirect) | ✅ |
| Deinstallation (`install.sh --deinstall [--purge]`) | ✅ |

### ✅ Phase 12 – Datei-Manager & 1-Klick-Update

| Feature | Status |
|---|---|
| Datei-Manager (Verzeichnisbaum, Textdateien bearbeiten) | ✅ |
| Hochladen, Ordner anlegen, umbenennen, löschen, herunterladen | ✅ |
| Rechte (chmod) und Eigentümer/Gruppe ändern (auch `/etc`, `/opt`) | ✅ |
| 1-Klick-Update in der Oberfläche (git pull + install.sh, Live-Log) | ✅ |
| Update-Prüfung gegen GitHub-Releases und VERSION-Datei | ✅ |
| Konfigurations-Migration (DB + Caddy + SMB als `.tar.gz`) | ✅ |
| Container-Migration von Unraid (Schritt-für-Schritt-Anleitung) | ✅ |

### ✅ Phase 13 – GPU, KI/Ollama, Samba-Lifecycle & SSE-Logs (`v0.7.1`)

| Feature | Status |
|---|---|
| GPU-Dashboard-Panel (NVIDIA, AMD, APU/UMA korrekt) | ✅ |
| GPU-Auslastung + VRAM als Donuts auf dem Dashboard | ✅ |
| KI/Ollama-Seite (Status, Modell-Liste, VRAM, Start/Stop) | ✅ |
| Hardware-Analyse: RAM, GPU, VRAM; empfohlene Modellgröße | ✅ |
| Ollama Zugriffsmodus: lokal / LAN per Schalter (systemd-Override) | ✅ |
| Zugriffs-URLs direkt in der UI; HTTPS-URL wenn Caddy-Proxy aktiv | ✅ |
| Beliebte Modell-Empfehlungen + HuggingFace GGUF-Suche | ✅ |
| GGUF-Quantisierungsselektor (Q4_K_M / Q5_K_M / Q8_0 …) | ✅ |
| Gleichzeitige Downloads (mehrere Modelle parallel) | ✅ |
| 1-Klick HTTPS via Caddy für Ollama (Hostname + alle LAN-IPs) | ✅ |
| Samba Auto-Lifecycle: Start/Stop/Firewall automatisch | ✅ |
| Container-Logs als SSE-Stream (Echtzeit, kein Polling) | ✅ |

### ✅ Phase 14 – Virtuelle IPs, App-Store, i18n (`v0.7.3`)

| Feature | Status |
|---|---|
| **Virtuelle IPs**: Container in macvlan/ipvlan-Netzwerke mit fester IP einhängen | ✅ |
| Virtuelle IPs beim Erstellen und Bearbeiten von Containern wählbar (NetworksPicker) | ✅ |
| Tab „Virtuelle IPs" in Netzwerke & VLANs: alle Container-IPs + VM-DHCP-Leases | ✅ |
| **App-Store**: Unraid Community Store (tausende Apps) + Docker Hub Suche | ✅ |
| Port-Konflikt-Prüfung vor Installation (mit Container-Name als Hinweis) | ✅ |
| Fehlgeschlagene Installation hinterlässt keine Container-Leichen (automatisches Aufräumen) | ✅ |
| Klartextübersetzung häufiger Docker-Fehler (address already in use) | ✅ |
| **Dynamische Kategorie-Tabs** in Container-Übersicht (erscheinen automatisch) | ✅ |
| **Mehrsprachigkeit (i18n)**: DE/EN umschaltbar, Browser-Autoerkennung, kein Framework | ✅ |
| Sprachumschalter in den Einstellungen; erweiterbar auf weitere Sprachen | ✅ |

### ✅ Phase 15 – IPv4/IPv6, UI-Sortierung, Inline-Macvlan, Firewall-Politik (`v0.7.4`)

| Feature | Status |
|---|---|
| **IPv4/IPv6-Umschalter** in den Einstellungen – Standard **nur IPv4** | ✅ |
| IPv6 wird über `sysctl` + `/etc/sysctl.d/99-corehub-ipv6.conf` (persistent) geschaltet | ✅ |
| Globale `app_settings`-Tabelle (Key/Value) für System-Einstellungen | ✅ |
| **Drag-&-Drop-Sortierung** von Sidebar-Einträgen und Panels (Greifpunkt) | ✅ |
| Sortierung **pro Benutzer serverseitig** gespeichert (`user_prefs`, debounced sync) | ✅ |
| **Inline-Macvlan** anlegen im App-Store- und Container-Dialog (Parent/Subnetz/Gateway/VLAN/IP) | ✅ |
| Host-Port-Konflikterkennung erfasst auch Nicht-Docker-Dienste (z. B. systemd-resolved:53) | ✅ |
| **Firewall ohne Auto-Schutzregeln**: Updates/Installer ändern keine ufw-Regeln mehr | ✅ |
| Beim Aktivieren: SSH (22) + Web-UI (443) nur LAN-only fürs echte PC-Subnetz, niemals Anywhere | ✅ |
| Firewall-Assistent (proaktiver Port-Scan) entfernt – Freigaben rein benutzergesteuert | ✅ |
| Update-Flow: sofortiger „Seite neu laden"-Button nach Installation (kein manuelles F5) | ✅ |

### ✅ Phase 16 – Mehrsprachigkeit & Proxy-Gating (`v0.7.5`)

| Feature | Status |
|---|---|
| **5 Sprachen**: Deutsch, English, Français, Español, Italiano | ✅ |
| Navigation, Sidebar, Seitentitel/-untertitel auf i18n-Schlüssel | ✅ |
| Fehlende Schlüssel fallen automatisch auf Deutsch zurück | ✅ |
| **Reverse-Proxy ein-/ausblendbar** über Einstellungen (Standard: aus) | ✅ |
| Proxy-Eintrag erscheint nur in der Sidebar, wenn aktiviert (`app_settings`) | ✅ |
| Backend-Auswahl vorbereitet: Caddy aktiv, nginx/Traefik als „geplant" | ✅ |

### ✅ Phase 17 – Tiefe i18n-Abdeckung (`v0.7.6`)

| Feature | Status |
|---|---|
| Prinzip **„Deutsch = Schlüssel"**: jeder deutsche Quelltext ist selbst der Übersetzungs-Schlüssel | ✅ |
| Modulweite `tt()`-Funktion – Übersetzung auch in Unterkomponenten/Helfern ohne Hook | ✅ |
| Panels, Dialoge, Buttons, Tooltips, `confirm()`/`alert()` auf `tt()` umgestellt | ✅ |
| ~470 UI-Texte in EN/FR/ES/IT übersetzt (`frontend/src/lib/locales/*.ts`) | ✅ |
| **Backend-Fehlermeldungen** werden zentral in `api.ts` (`req()`) via `tt()` übersetzt; Originaltext bleibt als `err.raw` erhalten | ✅ |
| 77 statische Backend-Meldungen in EN/FR/ES/IT übersetzt | ✅ |
| **Dynamische Backend-Meldungen** als `errorKey` + `errorVars` (Platzhalter) – Frontend setzt mit `tt(key, vars)` zusammen (z. B. Port-Konflikt, „Container existiert", Rate-Limit, Datei zu groß) | ✅ |
| Neue Sprache/Anpassung = nur Locale-Datei mit `deutsch → übersetzt` editieren | ✅ |

### ✅ Phase 18 – KI-Zentrale & lokale Sprachsteuerung (`v0.12.0`)

| Feature | Status |
|---|---|
| **KI-Zentrale**: animierte Weltkugel (Kontinente) im Farbkonzept, dreht sich | ✅ |
| Neuronales Netz nur wenn ein Modell geladen ist; offline bleibt nur die Kugel | ✅ |
| Netz reagiert (leuchtet/pulst schneller), wenn die KI arbeitet (keep_alive-Erkennung) | ✅ |
| Rechts: geladenes Modell + Status online (grün) / offline (grau); Hell- & Dunkelmodus | ✅ |
| **Sprachsteuerung – lokal & kostenlos** (kein Cloud-Dienst): Whisper (STT) + Piper (TTS) | ✅ |
| Weckwort frei konfigurierbar; Sprachen Deutsch / English / ไทย (Thai) | ✅ |
| Browser-Mikrofon → Server-Pipeline (VAD-Segmentierung, WebSocket) | ✅ |
| Gefühlt schnell: sofortiges „Verstanden"-Feedback, Antwort wird **satzweise** vorgelesen (kein Warten auf die Gesamtantwort) | ✅ |
| Einstellungen → Sprachsteuerung: An/Aus, Weckwort, Sprache, Vorlesen | ✅ |
| Installer: `sudo bash install.sh --voice` bzw. `--with-voice`; danach bei jedem Update automatisch mit aktualisiert (systemd-Dienst `vault-hub-voice`) | ✅ |
| Sprachdienst per Button aus dem Tool installierbar (`/api/voice/install`, kein Shell-Zugriff nötig) | ✅ |
| KI-Zentrale: automatisches Zuhören (Auto-Reconnect), Mute-Schalter; Wellen-Visualisierung (mittig nach außen, nur bei Weckwort/Antwort sichtbar) | ✅ |
| Weckwort einsprechen (Aufnahme → Whisper), TTS-Stimme je Sprache wählbar, Whisper-Modell (tiny/base/small/medium) umschaltbar | ✅ |
| TTS-Motor **Kokoro** zusätzlich (sehr gute Englisch-Stimmen; Deutsch/Thai bleiben Piper). Stimmen-ID mit Motor-Präfix `piper:` / `kokoro:` | ✅ |
| TTS-Motor **Qwen3-TTS** (1.7B, optional) für **Deutsch** in Studioqualität – `sudo bash install.sh --voice-qwen` oder Button in den Einstellungen (schwer: PyTorch, GPU empfohlen) | ✅ |
| **Eigene Stimme klonen** (Qwen zero-shot): ~6 s aufnehmen → automatisch transkribiert → als Stimme wählbar/löschbar (DE/EN) | ✅ |
| **Cache-Verwaltung**: heruntergeladene Whisper-/Qwen-Modelle, Piper/Kokoro & geklonte Stimmen mit Größe anzeigen und einzeln löschen (werden bei Bedarf neu geladen) | ✅ |

### ⏳ Geplant / Ideen

| Feature | Status |
|---|---|
| Restliche Detailtexte & Backend-Meldungen übersetzen | ⏳ |
| Reverse-Proxy: nginx/Traefik tatsächlich anbinden | ⏳ |

---

## Sicherheitshinweise

> Diese App hat vollen Zugriff auf Docker (= praktisch root) und Systemdienste.

- Niemals ohne Passwort betreiben
- Default-Passwort `admin` nach erstem Login sofort ändern
- Hinter einem Reverse-Proxy mit HTTPS betreiben
- Nur im lokalen Netzwerk oder per VPN zugänglich machen
- Audit-Log ist aktiv: jede Aktion wird protokolliert

---

## Start (Entwicklung)

```bash
# Backend
cd backend && npm install && npm run dev

# Frontend (anderes Terminal)
cd frontend && npm install && npm run dev

# Öffnen
http://localhost:5173
Login: admin / admin
```

## Produktion

```bash
sudo bash install.sh
# → http://SERVER-IP:4200
```
