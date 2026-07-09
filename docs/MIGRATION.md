# Container-Migration: Unraid → Vault-Hub (manuell)

Diese Anleitung beschreibt, wie du deine Docker-Container samt App-Daten von einem
**Unraid-Server** (oder einem beliebigen anderen Docker-Host) auf **Vault-Hub** umziehst.

> **Warum manuell?** Die Migration einmalig von Hand zu machen ist transparenter und
> verlässlicher als ein Assistent: Du siehst genau, was kopiert wird, behältst die
> Kontrolle über Pfade/Rechte und kannst pro Container entscheiden. Die folgenden
> Schritte sind copy-paste-fertig.

Die Migration läuft in fünf Schritten:

1. [Verbindung & Überblick](#1-verbindung--überblick)
2. [Container analysieren](#2-container-analysieren)
3. [App-Daten kopieren](#3-app-daten-kopieren)
4. [Container in Vault-Hub neu anlegen](#4-container-in-vault-hub-neu-anlegen)
5. [Umschalten & aufräumen](#5-umschalten--aufräumen)

---

## Voraussetzungen

- SSH-Zugang zum alten Server (Unraid: *Settings → Management Access*, SSH aktivieren)
- Auf dem neuen Vault-Hub-Server ist **Docker** installiert und läuft
- Genug freier Speicherplatz für die App-Daten (siehe Schritt 2)

Platzhalter in dieser Anleitung:

| Platzhalter | Bedeutung | Beispiel |
|---|---|---|
| `ALT_HOST` | IP/Hostname des alten Servers | `192.168.1.100` |
| `ALT_USER` | SSH-Benutzer dort | `root` |
| `SRC` | Appdata-Pfad auf dem alten Server | `/mnt/user/appdata` |
| `DST` | Ziel-Pfad auf Vault-Hub | `/var/lib/appdata` |

---

## 1. Verbindung & Überblick

SSH-Verbindung testen und Docker-Version auf dem alten Server prüfen:

```bash
ssh ALT_USER@ALT_HOST 'docker version --format "{{.Server.Version}}"; hostname'
```

Ziel-Verzeichnis auf Vault-Hub anlegen (FHS-konform unter `/var/lib`):

```bash
sudo mkdir -p /var/lib/appdata
```

---

## 2. Container analysieren

Liste aller Container auf dem alten Server (auch gestoppte):

```bash
ssh ALT_USER@ALT_HOST 'docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"'
```

Für **jeden** Container, den du umziehen willst, die vollständige Konfiguration ansehen –
besonders **Image, Ports, Umgebungsvariablen (Env) und Volumes (Binds)**:

```bash
# Ports + Env + Bind-Mounts kompakt anzeigen (CONTAINER = Name)
ssh ALT_USER@ALT_HOST 'docker inspect CONTAINER \
  --format "Image: {{.Config.Image}}
Ports: {{range \$p,\$c := .HostConfig.PortBindings}}{{\$p}} -> {{(index \$c 0).HostPort}} {{end}}
Restart: {{.HostConfig.RestartPolicy.Name}}
Env:{{range .Config.Env}}
  {{.}}{{end}}
Mounts:{{range .Mounts}}
  {{.Source}} -> {{.Destination}}{{end}}"'
```

Datenmenge der App-Daten ermitteln (damit du den Platzbedarf kennst):

```bash
ssh ALT_USER@ALT_HOST 'du -sh SRC/*'
```

> **Tipp:** Notiere dir je Container Image, Port-Zuordnungen, Env-Variablen und die
> Volume-Pfade. Diese Infos brauchst du in Schritt 4. Du kannst die `docker inspect`-
> Ausgabe auch in eine Datei umleiten und über den **Datei-Manager** in Vault-Hub ansehen.

---

## 3. App-Daten kopieren

Die App-Daten (Configs, Datenbanken usw.) liegen meist unter `SRC`.
Am besten **vor** dem Kopieren die Container auf dem alten Server stoppen, damit keine
Datenbank mitten im Schreiben kopiert wird:

```bash
# auf dem alten Server – Container stoppen (Beispiel)
ssh ALT_USER@ALT_HOST 'docker stop CONTAINER1 CONTAINER2 …'
```

Dann die Daten per **rsync** auf Vault-Hub holen (resume-fähig, überträgt nur Änderungen):

```bash
# auf dem Vault-Hub-Server ausführen
sudo rsync -aAXv --info=progress2 \
  ALT_USER@ALT_HOST:SRC/ /var/lib/appdata/
```

- `-aAX` erhält Rechte, ACLs, Eigentümer und erweiterte Attribute
- `--info=progress2` zeigt den Gesamtfortschritt
- Lässt sich jederzeit abbrechen und erneut starten – rsync macht dort weiter, wo es aufhörte

Ist `rsync` auf dem alten Server nicht vorhanden, geht auch `scp -r`:

```bash
sudo scp -r ALT_USER@ALT_HOST:SRC/* /var/lib/appdata/
```

---

## 4. Container in Vault-Hub neu anlegen

Jetzt die Container auf Vault-Hub neu erstellen – mit denselben Images, Ports, Env-Variablen
und den **lokalen** Volume-Pfaden (`/var/lib/appdata/...` statt `/mnt/user/appdata/...`).

Zwei Wege:

### a) Über die Vault-Hub-Oberfläche (empfohlen)

1. **Container → Neu** (Wizard) öffnen
2. Image, Ports, Env-Variablen aus deinen Notizen (Schritt 2) eintragen
3. Bei **Volumes** den lokalen Pfad angeben, z. B.
   `Host: /var/lib/appdata/adguard  →  Container: /opt/adguardhome/conf`
4. Erstellen, noch **nicht** starten – erst in Schritt 5

Für viele bekannte Dienste geht es noch schneller über **App-Vorlagen**: Vorlage wählen,
nur den Volume-Pfad auf dein kopiertes `/var/lib/appdata/<dienst>` setzen.

### b) Über die Kommandozeile (`docker run`)

Beispiel (AdGuard Home) – passe Image, Ports, Volumes und Env an deinen Container an:

```bash
docker run -d --name adguard \
  --restart unless-stopped \
  -p 53:53/tcp -p 53:53/udp -p 3000:3000/tcp \
  -v /var/lib/appdata/adguard/conf:/opt/adguardhome/conf \
  -v /var/lib/appdata/adguard/work:/opt/adguardhome/work \
  adguard/adguardhome:latest
```

> **Wichtig:** Die Reihenfolge `-v HOST_PFAD:CONTAINER_PFAD` muss exakt den Mounts aus
> Schritt 2 entsprechen – nur der Host-Teil ändert sich von `SRC/...` auf `/var/lib/appdata/...`.

---

## 5. Umschalten & aufräumen

1. **Auf dem alten Server** die migrierten Container endgültig stoppen (falls noch aktiv):
   ```bash
   ssh ALT_USER@ALT_HOST 'docker stop CONTAINER1 CONTAINER2 …'
   ```
2. **Auf Vault-Hub** die neuen Container starten (UI: *Start* · CLI: `docker start <name>`)
3. Jeden Dienst im Browser/Client prüfen – Daten, Logins, Einstellungen vorhanden?
4. Erst wenn alles läuft: alte Container auf dem Unraid-Server löschen (oder den
   Unraid-Docker-Dienst deaktiviert lassen, bis du sicher bist).

### Wenn Ports kollidieren

Belegt ein Port auf Vault-Hub bereits etwas, zeigt `ss -tlnp` (oder die *Sicherheit*-Seite)
den Konflikt. Entweder den anderen Dienst stoppen oder im Wizard einen anderen Host-Port wählen.

### Rechte-Probleme

Stimmen Eigentümer/Rechte nach dem Kopieren nicht, hilft der **Datei-Manager** in Vault-Hub
(Berechtigungen ändern) oder klassisch:

```bash
sudo chown -R 1000:1000 /var/lib/appdata/<dienst>   # UID/GID je nach Image
```

---

## Spickzettel

```bash
# 1. Überblick
ssh ALT_USER@ALT_HOST 'docker ps -a'

# 2. Container-Details
ssh ALT_USER@ALT_HOST 'docker inspect CONTAINER'

# 3. Daten kopieren (resume-fähig)
sudo rsync -aAXv --info=progress2 ALT_USER@ALT_HOST:SRC/ /var/lib/appdata/

# 4. Container neu anlegen → Vault-Hub UI (Container → Neu) oder docker run …

# 5. Alt stoppen, neu starten, prüfen
```

Fertig – deine Dienste laufen jetzt unter Vault-Hub. 🎉
