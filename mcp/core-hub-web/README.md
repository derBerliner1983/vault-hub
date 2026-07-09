# Vault-Hub Web-MCP-Server

Gibt einem LLM **Internetzugriff** über zwei Werkzeuge:

- `web_search(query, max)` – DuckDuckGo-Suche (kein API-Key/Konto nötig)
- `web_fetch(url, maxChars)` – Seiteninhalt als Klartext

Nutzbar in jedem MCP-Client (Claude Desktop, Claude Code, Cursor …).

## Installation

```bash
cd mcp/vault-hub-web
npm install
```

## In einen MCP-Client eintragen

**Claude Desktop / Claude Code** (`claude_desktop_config.json` bzw. `.mcp.json`):

```json
{
  "mcpServers": {
    "vault-hub-web": {
      "command": "node",
      "args": ["/opt/vault-hub/mcp/vault-hub-web/index.mjs"]
    }
  }
}
```

Pfad ggf. an dein Installationsverzeichnis anpassen. Danach den Client neu
starten – die Werkzeuge `web_search` und `web_fetch` stehen bereit.

## Verhältnis zum eingebauten Internetzugriff

Vault-Hub hat den Internetzugriff **auch direkt eingebaut**: In der KI-Zentrale
unter *Internetzugriff (KI)* einschalten – dann ergänzt das lokale Modell seine
Antworten automatisch mit Live-Web-Ergebnissen (per Knopfdruck, ohne MCP-Client).

Der MCP-Server hier ist die **Werkzeug-Variante** für externe Agenten, die MCP
sprechen und die Websuche explizit als Tool aufrufen wollen.
