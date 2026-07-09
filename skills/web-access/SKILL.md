---
name: web-access
description: Gibt der KI Internetzugriff über Vault-Hub – Websuche und Seitenabruf, um Antworten mit aktuellen Informationen zu belegen. Nutze diese Fähigkeit, wenn eine Frage aktuelle, faktische oder nach dem Trainingsstand liegende Informationen benötigt (Nachrichten, Preise, Wetter, Versionsstände, Öffnungszeiten …).
---

# Web-Zugriff über Vault-Hub

Diese Fähigkeit erlaubt der KI, aktuelle Informationen aus dem Internet zu holen
und in ihre Antwort einzubeziehen. Sie ist rein lokal orchestriert (DuckDuckGo,
kein Konto/API-Key) und liefert Quellen mit.

## Wann nutzen

- Die Frage betrifft **aktuelle** Ereignisse, Zahlen oder Stände.
- Das Wissen liegt **nach dem Trainingsstand** des Modells.
- Der Nutzer bittet ausdrücklich, „im Internet nachzusehen".

Bei zeitlosem Allgemein- oder Kontextwissen (inkl. Obsidian-Notizen) **nicht**
nötig – dann direkt antworten.

## Werkzeuge

Über den MCP-Server `vault-hub-web` (siehe `mcp/vault-hub-web/`):

- `web_search(query, max)` – liefert Titel + URLs der besten Treffer.
- `web_fetch(url, maxChars)` – liefert den lesbaren Text einer Seite.

Typischer Ablauf: erst `web_search`, dann die 1–3 relevantesten Treffer mit
`web_fetch` öffnen, Fakten extrahieren, Antwort formulieren.

## Regeln

1. **Quellen nennen** – gib die verwendeten URLs an.
2. **Nichts erfinden** – nur wiedergeben, was die Seiten belegen; bei
   widersprüchlichen Quellen darauf hinweisen.
3. **Sparsam abrufen** – so wenige Seiten wie nötig, kurz und präzise antworten.
4. **Datenschutz** – keine privaten/internen Daten in Suchanfragen schreiben.

## Alternative ohne MCP

In der Vault-Hub-Oberfläche unter *KI-Zentrale → Internetzugriff (KI)* lässt sich
derselbe Zugriff per Schalter aktivieren; das lokale Modell ergänzt Antworten
dann automatisch mit Web-Ergebnissen – ohne separaten MCP-Client.
