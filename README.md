<div align="center">

# ⬡ Vault-Hub

**Die Zentrale deines Linux-Servers.** · `v0.7.6`

Web-basiertes Server-Management für headless Linux – Docker, VMs, Netzwerke, Firewall, Sicherheit, KI & mehr.
Alles im Browser. Ohne SSH, ohne Desktop.

</div>

---

## Inhaltsverzeichnis
- [Was ist Vault-Hub?](#was-ist-vault-hub)
- [Features](#features)
- [Installation](#installation)
- [Architektur & Sicherheit](#architektur--sicherheit)
- [Entwicklung](#entwicklung)
- [Tech-Stack](#tech-stack)
- [Roadmap & Timeline](#roadmap--timeline)

---

## Was ist Vault-Hub?

Ein selbst-gehostetes Verwaltungs-Dashboard für Linux-Server. Du steuerst Docker-Container,
virtuelle Maschinen, Netzwerke/VLANs, Backups, Benutzer, SMB-Freigaben, System-Updates,
lokale KI-Modelle (Ollama) und die Server-Sicherheit – komplett bequem über die Weboberfläche.
Helles und dunkles Design, aufklappbare Panels, läuft auf jedem Gerät (PC, Handy, Tablet).

Vault-Hub läuft **direkt auf Linux** (als systemd-Dienst), nicht in einem Container – nur so kann
es den Host selbst verwalten (Updates, Dienste, Benutzer, Firewall …).

---

## Features

### 📊 Dashboard (Live-Monitoring alle 2 s, aufklappbare Panels)
- **Prozessor**: Gesamtlast als Tortendiagramm + Live-Verlaufsgraph, Einzelkerne einklappbar
- **System**: RAM-Donut (echter Wert wie htop) mit Aufteilung System / VM / Docker / Frei, Festplatten-Donuts pro Mount
- **GPU**: GPU-Auslastung (%) + VRAM-/Unified-Memory-Verbrauch als Donuts – NVIDIA (nvidia-smi) und AMD (amdgpu sysfs) erkannt; APU/UMA-Systeme (z. B. Ryzen AI MAX) werden korrekt als Unified Memory dargestellt
- **Netzwerk**: alle Schnittstellen mit Live-Durchsatz
- **Optimierung**: erkennt RAM-/CPU-Fresser, gestoppte Container, hohe Swap-Nutzung, volle Platten – mit Direktlink zur Aktion

### ⚡ Taskmanager
- Prozesse auflisten, beenden (TERM) oder hart killen (KILL)
- **Dienste-Tab**: systemd-Dienste starten / stoppen / neustarten / Autostart ein-/ausschalten

### 🖥️ Terminal (Web-Konsole)
- Interaktive **Root-Shell direkt im Browser** (xterm.js + WebSocket) – falls du mal nicht per SSH rankommst
- Nur für Admins, Authentifizierung über das Login-Cookie

### 🐳 Container
- Anlegen (Wizard: Image, Ports, Env, Volumes, Gruppe, eigenes Icon)
- Start / Stop / Restart / Delete · Neustart-Richtlinien
- **Gruppen / Kategorien**: Container in auf-/zuklappbare Gruppen sortieren (z. B. „Datenbanken") – Zustand bleibt gespeichert; **dynamische Kategorie-Tabs** oben in der Übersicht zum Filtern
- **Eigenes Icon** pro Container (Bild-URL) oder automatisches Symbol
- **Detailseite** pro Container: **Live-Logs als SSE-Stream** (Echtzeit, kein Polling), CPU-Verlaufsgraph, RAM-Anzeige, Ports, Volumes, Env-Variablen; Container bearbeiten/neu anlegen inkl. **virtuelle IPs / mehrere Netzwerke**
- **„Update verfügbar"-Erkennung** (Registry-Digest-Vergleich) + 1-Klick-Update
- **Virtuelle IPs**: Container können zusätzlich in macvlan/ipvlan-Netzwerke eingehängt werden (feste IP oder DHCP) – direkt beim Erstellen oder Bearbeiten

### 🧩 App-Vorlagen / 1-Klick-Installation
- **Unraid Community Store** (tausende Apps aus dem Unraid-Feed) + **Docker Hub Suche**
- Pro Vorlage: Image, Ports, Volumes & Env vorausgefüllt – nur Name/Passwort setzen
- **Port-Konflikt-Erkennung vorab**: belegte Host-Ports werden vor dem Image-Download gemeldet (mit Hinweis auf Macvlan als Alternative für Port 53 usw.)
- Bei Installationsfehler: halb angelegte Container werden automatisch entfernt (keine Leichen)
- Netzwerkmodus wählbar: Standard (bridge), host, oder eigenes macvlan-Netz mit **statischer IP**
- **Macvlan direkt im Dialog anlegen**: Parent-Interface, Subnetz, Gateway, VLAN & IP setzen – ohne Umweg über die Netzwerke-Seite (auch beim Container-Bearbeiten/-Erstellen)
- Host-Port-Konflikte erkennen jetzt auch Nicht-Docker-Dienste (z. B. systemd-resolved auf Port 53)
- Kategorien und Icons werden beim Installieren automatisch übernommen

### 🖥️ Virtuelle Maschinen (libvirt/KVM)
- VMs erstellen (RAM, CPU, Disk, ISO), starten / herunterfahren / neustarten
- Snapshots, Autostart, Löschen

### 🌐 Netzwerke & VLANs
- **Docker-Netzwerke**: bridge / macvlan / ipvlan, VLAN-Tag, isolierte Netze, feste IP + Aliasse
- **VM-Netzwerke**: libvirt-Netzwerke (NAT / isoliert / Bridge + VLAN), VM anhängen
- **Virtuelle IPs (Tab)**: Übersicht aller Container-IPs und VM-DHCP-Leases nach Netzwerk/Treiber
- **Firewall (ufw)** – vollständige Regelwerwaltung:
  - Regeln allow/deny/reject nach Port / Protokoll / Quell-IP / Richtung (ein-/ausgehend)
  - Regeln mit **Kommentar/Namen** anlegen, **bearbeiten**, **filtern** und löschen
  - **Mehrere Quell-Adressen** auf einmal (→ je eine Regel)
  - Regeln **deaktivieren/reaktivieren** (Parkbucht – gemerkt zum Wiederherstellen)
  - **Keine automatischen Schutz-Regeln**: Updates fügen keine Regeln hinzu, der Admin entscheidet selbst über Freigaben
  - Beim **Aktivieren** der Firewall bekommen SSH (22) und Web-UI (443) – nur falls noch keine Regel existiert – eine Freigabe **ausschließlich fürs echte LAN-Subnetz des PCs** (aus `ip addr`, RFC-1918); **niemals** Anywhere/Internet
  - Port-Freigaben **pro Port als LAN/Internet-Schalter** unter „Sicherheit"
- **Verbindungsprotokoll** (persistente DB): zeigt blockierte/erlaubte Verbindungen, filterbar, CSV-Export

### 🔒 HTTPS & Reverse-Proxy (Caddy) — optional einblendbar
- **Standardmäßig ausgeblendet**: erst über Einstellungen → Reverse-Proxy aktivieren, dann erscheint der Eintrag in der Navigation
- Backend-Auswahl vorbereitet (Caddy aktiv; nginx/Traefik als „geplant")
- Pro Container HTTPS per Schalter aktivieren oder alle auf einmal
- Automatische Zertifikate über interne CA (kein Let's Encrypt/Domain nötig)
- Root-CA-Download → einmal auf Geräten installieren, überall grünes Schloss
- Für öffentliche Domains: automatisches Let's Encrypt

### 🛡️ Sicherheit (Audit & Härtung)
- Sicherheits-Scan mit **Score (0–100)** + Note
- Prüft: SSH, Firewall, Sicherheitsupdates, fail2ban, AppArmor/SELinux, Konten ohne Passwort, offene Ports, privilegierte Container, docker.sock, Standard-Passwort
- **1-Klick-Härtung** pro Fund
- **Alarm-Regeln** (vordefiniert + eigene Schwellwerte), **Hintergrund-Monitor** alle 60 s mit Anti-Spam

### 🦠 Virenschutz (ClamAV)
- ClamAV installieren, Signaturen aktualisieren, Verzeichnisse scannen (Live-Fortschritt)

### 🔄 System-Updates
- apt / dnf / pacman: Updates suchen, einzeln oder alle installieren

### 💾 Backups
- Docker-Volumes, Verzeichnisse (tar.gz), VM-qcow2 – Download / Löschen
- **Automatische Zeitpläne** (Cron) mit Aufbewahrung; alte Backups automatisch aufgeräumt

### 🔔 Benachrichtigungen
- **Webhook** (Discord, Slack, Mattermost) und **E-Mail per SMTP**
- Ereignisse einzeln schaltbar; eigene Empfänger-Adressen pro Alarm-Regel

### 📁 SMB-Freigaben & 👥 Benutzer
- Ordner freigeben, SMB-Benutzer verwalten; **Samba Auto-Lifecycle** (Firewall automatisch)
- Vault-Hub-Logins (Rollen) + Linux-Benutzer + **2FA/TOTP**

### 📂 Datei-Manager
- Verzeichnisbaum, Textdateien bearbeiten, hochladen, umbenennen, löschen, herunterladen
- Rechte (chmod) und Eigentümer auch in `/etc`, `/opt` via sudoers

### 🤖 KI / Ollama
- Status, Modelle, VRAM-Anzeige, Hardware-Analyse, empfohlene Modellgröße
- **Zugriffsmodus**: lokal / LAN per Schalter; **1-Klick HTTPS** via Caddy
- **Modell-Suche** (Empfehlungen + HuggingFace GGUF-Suche + Quantisierungsselektor)
- Mehrere Modelle parallel laden

### 🌍 Mehrsprachigkeit
- **5 Sprachen** umschaltbar: Deutsch, Englisch, Français, Español, Italiano (Einstellungen → Sprache)
- Browsersprache wird automatisch erkannt; Wahl im Browser gespeichert
- **Tiefe Abdeckung**: Navigation, Seitentitel, Panels, Dialoge, Buttons & Tooltips übersetzt
- **Deutsch = Schlüssel**: jeder deutsche Quelltext ist selbst der Übersetzungs-Schlüssel – fehlt eine Übersetzung, erscheint automatisch der deutsche Originaltext
- **Sprache leicht anpassbar**: neue Sprache = eine Locale-Datei mit `deutsch → übersetzt`-Zuordnungen, fertig (`frontend/src/lib/locales/`)

### ⚙️ Einstellungen
- Passwort & 2FA, System-Info, Version & Update-Prüfung (git + GitHub-Releases)
- **1-Klick-Update** in der Oberfläche (git pull + install.sh, Live-Log) – nach der Installation erscheint sofort der **„Seite neu laden"**-Button (kein manuelles F5 nötig)
- **IPv4/IPv6-Umschalter**: standardmäßig **nur IPv4**; IPv6 bei Bedarf aktivierbar (persistent via `sysctl`)
- **Konfigurations-Migration**: Export/Import als `.tar.gz` (DB + Caddy-Zertifikate + SMB)

### ↕️ Anpassbare Oberfläche (pro Benutzer)
- **Sidebar-Einträge** und **Panels** per **Drag & Drop** sortieren (Greifpunkt zum Ziehen)
- Reihenfolge wird **serverseitig pro Benutzer** gespeichert – jeder hat sein eigenes Layout

---

## Installation

```bash
git clone https://github.com/derberliner1983/docker-gui.git
cd docker-gui
sudo bash install.sh
```

→ Erreichbar unter `http://SERVER-IP:4200` · Login: `admin` / `admin`
⚠️ **Passwort nach dem ersten Login ändern!**

### Update auf eine neue Version

**In der Oberfläche:** Einstellungen → „Version & Updates" → **„Jetzt aktualisieren"**

**Manuell:**
```bash
cd docker-gui
git pull
sudo bash install.sh
```

### Optionale Abhängigkeiten

```bash
sudo apt install docker.io                                   # Container
sudo apt install qemu-kvm libvirt-daemon-system virtinst     # VMs
sudo apt install samba                                       # SMB-Freigaben
sudo apt install caddy                                       # HTTPS
sudo apt install ufw                                         # Firewall
sudo apt install fail2ban unattended-upgrades                # Härtung
sudo apt install clamav clamav-daemon                        # Virenschutz
curl -fsSL https://ollama.com/install.sh | sh               # KI / Ollama
```

Fehlt ein Tool, zeigt das Modul einen Hinweis statt eines Fehlers.

---

## Architektur & Sicherheit

```
Browser (überall)
    │ HTTPS + REST + WebSocket + SSE
    ▼
Vault-Hub (systemd-Dienst auf dem Host)
├── Fastify (Node.js / TypeScript)
├── JWT-Auth + bcrypt, 2FA/TOTP, Rollen, Audit-Log
├── SQLite (vault-hub.db)
└── Steuert via Docker-API, virsh, systemd, ufw, samba, caddy …
```

> Vault-Hub hat weitreichenden Zugriff auf den Server:
> - Default-Passwort sofort ändern
> - Nur im LAN oder hinter VPN/Reverse-Proxy betreiben
> - Privilegierte Befehle laufen über eine **sudoers-Allowlist** (kein Root-Prozess)
> - Jede Aktion wird im Audit-Log protokolliert

---

## Entwicklung

```bash
npm run install:all        # alle Abhängigkeiten
npm run dev                # Backend (4200) + Frontend (5173) parallel
```

→ `http://localhost:5173` · Login: `admin` / `admin`

---

## Tech-Stack

| Bereich | Technologie |
|---|---|
| Frontend | React 18, TypeScript, Vite, lucide-react |
| Backend | Fastify, TypeScript, dockerode, systeminformation |
| Auth | JWT, bcrypt, Rollen (Admin/Viewer), 2FA/TOTP (RFC 6238) |
| Datenbank | SQLite (better-sqlite3) |
| HTTPS | Caddy (interne CA / Let's Encrypt) |
| i18n | Eigenes leichtgewichtiges i18n-System (kein Framework) |
| GPU-Monitoring | NVIDIA (nvidia-smi), AMD (amdgpu sysfs), APU/UMA-Erkennung |
| KI | Ollama REST API, HuggingFace API (GGUF-Suche), systemd-Override |
| Design | Eigenes Design-System (Design-Tokens, SSE-Logs, xterm.js) |
| Deployment | systemd-Service, install.sh, sudoers-Allowlist, `.deb`-Builder |

---

## Roadmap & Timeline

| Phase | Inhalt | Status |
|---|---|---|
| **1** | Grundgerüst, Login, Container-Verwaltung, Installer | ✅ |
| **2** | Dashboard-Monitoring (CPU/RAM/Disk/Netz), Taskmanager | ✅ |
| **3** | Virtuelle Maschinen (libvirt/KVM) | ✅ |
| **4** | System-Updates, Backups, SMB, Benutzerverwaltung | ✅ |
| **5** | Automatisches HTTPS / Reverse-Proxy (Caddy) | ✅ |
| **6** | Einstellungen, Passwort, Migration (Export/Import) | ✅ |
| **7** | Netzwerke & VLANs (Docker + VMs), Firewall | ✅ |
| **8** | Sicherheits-Scan, Härtung, SSH-Steuerung | ✅ |
| **9** | Container-Updates, Virenschutz, 2FA, Backup-Zeitpläne, Benachrichtigungen, App-Vorlagen | ✅ |
| **10** | Container-Detailseite, Rate-Limiting, Session-Timeout, Mobile-Optimierung, `.deb`-Builder | ✅ |
| **11** | SMTP-E-Mail, Alarm-Regeln, Optimierungs-Panel, Web-Terminal | ✅ |
| **12** | Datei-Manager, 1-Klick-Update in der Oberfläche, Container-Migration (Doku) | ✅ |
| **13** | GPU-Dashboard, KI/Ollama (HTTPS, GGUF, parallele Downloads), Samba Auto-Lifecycle, SSE-Logs | ✅ |
| **14** | **Virtuelle IPs** (macvlan/ipvlan, mehrere Netzwerke pro Container, IP-Übersicht-Tab), **App-Store** (Unraid Community + Docker Hub, Port-Konflikt-Erkennung, Aufräumen bei Fehler), **Dynamische Kategorie-Tabs** (Container-Übersicht), **Mehrsprachigkeit** (DE/EN, erweiterbar) | ✅ `v0.7.3` |
| **15** | **IPv4/IPv6-Umschalter** (Standard nur IPv4), **Drag-&-Drop-Sortierung** von Sidebar & Panels (pro Benutzer, serverseitig), **Inline-Macvlan** im Container-/App-Dialog, **Firewall ohne Auto-Schutzregeln** (nur LAN-only-Freigabe für SSH/443 beim Aktivieren), Host-Port-Konflikterkennung inkl. Nicht-Docker-Dienste, Update mit sofortigem Reload-Button | ✅ `v0.7.4` |
| **16** | **5 Sprachen** (DE/EN/FR/ES/IT), Navigation & Seitentitel auf i18n-Schlüssel, **Reverse-Proxy ein-/ausblendbar** über Einstellungen (Standard aus, Backend-Auswahl vorbereitet) | ✅ `v0.7.5` |
| **17** | **Tiefe i18n-Abdeckung** (Panels, Dialoge, Buttons, Tooltips, Bestätigungen) nach dem Prinzip „Deutsch = Schlüssel"; ~470 Texte in EN/FR/ES/IT übersetzt, modulweite `tt()`-Funktion für Übersetzung auch in Unterkomponenten | ✅ `v0.7.6` |

### Geplant / Ideen
- ⏳ Restliche Detailtexte/Backend-Meldungen übersetzen
- ⏳ Reverse-Proxy: nginx/Traefik tatsächlich anbinden

Die vollständige technische Planung steht in [KONZEPT.md](./KONZEPT.md).
