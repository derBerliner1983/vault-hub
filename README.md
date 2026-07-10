<div align="center">

# ⬡ Vault-Hub

**Minimales, erweiterbares Server-Grundgerüst für Ubuntu LTS.**

Leere Hülle mit Login (Passwort + 2FA), Store und Einstellungen —
alles Weitere kommt als Plugin aus dem Store.

</div>

---

## Was ist Vault-Hub?

Vault-Hub ist ein **leeres Grundgerüst**. Nach dem Login gibt es nur:

- **Start** – leeres Dashboard
- **Store** – Plugins (Apps *und* System-Erweiterungen) installieren, aktualisieren, entfernen
- **Einstellungen** – Account (Passwort + 2FA), Version & Updates, updatefähige Apps

Der Kern bringt **keine** Features mit. Funktionen wie SSH, Reverse-Proxy oder
Virenschutz werden als **Plugins** über den Store nachgeladen und lassen sich
jederzeit wieder entfernen. Jede App im Store bringt ihre **eigene Beschreibung**
(was sie macht / erweitert) und ihre **eigenen Sprach-Variablen** mit — deshalb
bleibt diese README bewusst schlank.

## Zwei Plugin-Typen (ein Mechanismus)

| Typ | Wirkung | Beispiel |
|-----|---------|----------|
| **System-Erweiterung** | klinkt sich in die Shell ein (Einstellungs-Sektion, Dienst-Schalter, Widget) | SSH, Caddy |
| **App** | eigene Seite + Sidebar-Eintrag | Virenschutz, Jarvis |

Plugins deklarieren in ihrem `plugin.json` selbst, wo sie sich einklinken
(*Contribution Points*). Der Kern verdrahtet das **zur Laufzeit** — ohne
Neukompilieren.

## Installation (Ubuntu LTS, nativ, kein Docker)

```bash
git clone https://github.com/derBerliner1983/vault-hub.git
cd vault-hub
sudo bash install.sh            # Standard-Port 4300
# sudo bash install.sh --port 8443   # anderen Port erzwingen
```

Ist der Standard-Port belegt (z. B. weil Core-Hub läuft), fragt die Installation
nach einem anderen Port. Vault-Hub läuft als systemd-Dienst `vault-hub`.

## Updates

- **Grundsystem:** Einstellungen → *Version & Updates* (git-basiert gegen dieses Repo).
- **Apps/Plugins:** Store bzw. Einstellungen → *Updatefähige Apps* (Versionsvergleich
  gegen die Store-Registry, Update ohne Neukompilieren des Kerns).

## Deinstallation / Reset

`deinstall.sh` setzt das System auf den Stand **vor der Installation** zurück –
es fasst nur an, was Vault-Hub selbst angelegt/geändert hat:

```bash
sudo bash deinstall.sh                    # Kern entfernen, Daten behalten
sudo bash deinstall.sh --purge            # + Daten/DB/Plugins löschen
sudo bash deinstall.sh --purge --reset-packages          # + per App installierte Pakete entfernen
sudo bash deinstall.sh --purge --reset-packages --reset-users --yes   # voller Reset ohne Rückfragen
```

Was passiert:
- **Kern** (Dienst, Programm, Dienstbenutzer, sudoers, Caddy-Site, Firewallregeln,
  Daten/DB, **alle in der App gemachten Einstellungen**) wird entfernt.
- **Plugin-Änderungen** nehmen die Plugins per `uninstall.sh`-Hook selbst zurück
  (z. B. SMB-Block in `smb.conf` + UFW-Regeln, ClamAV-Dienste).
- **Audit-Report:** Vor dem Löschen wird ein Protokoll **aller** über die App
  gemachten Systemänderungen nach `/var/log/vault-hub-uninstall-*.txt` gesichert
  (installierte Pakete, angelegte Benutzer, Freigaben …). So ist alles
  nachvollziehbar. *(Für den Detail-Report `sqlite3` installieren.)*
- **Nicht angetastet:** alles, was du direkt über **Terminal/SSH** gemacht hast –
  das gehört dir und wird bewusst nicht protokolliert (nur „Terminal geöffnet"
  wird geloggt, nicht die eingegebenen Befehle).
- Systemweite Eingriffe (Pakete, Linux-Benutzer) werden **standardmäßig nicht**
  automatisch entfernt, sondern nur berichtet – erst `--reset-packages` /
  `--reset-users` entfernen sie (mit Rückfrage).

## Store

Der Store liest eine `registry.json`. Standardmäßig kommt sie **mit diesem Repo**
mit (`store/registry.json`); über `STORE_URL` / `STORE_REPO` kann der Store später
umziehen. Jedes Store-Item trägt eine `version` (für den Update-Vergleich), eine
lokalisierbare `description` und optional eigene `i18n`-Sprach-Variablen.

## Sprache (modular)

Basis ist **Deutsch + Englisch**. Weitere Sprachen können modular ergänzt werden
(Sprach-Plugin aus dem Store). Jede App bringt ihre Strings selbst mit; kennt eine
App die eingestellte Sprache nicht, greift automatisch **Deutsch → Englisch**.
