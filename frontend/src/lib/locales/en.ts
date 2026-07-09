// English core dictionary. Keys are the German source strings (German is the
// base language). Only the skeleton's own strings are covered here; apps/plugins
// ship their own strings via registerMessages('en', {…}). Missing keys fall back
// to German automatically.
export const en: Record<string, string> = {
  // Layout / navigation
  'Vault-Hub': 'Vault-Hub',
  'Übersicht': 'Overview',
  'System': 'System',
  'Start': 'Start',
  'Store': 'Store',
  'Einstellungen': 'Settings',
  'Aufklappen': 'Expand',
  'Einklappen': 'Collapse',
  'Menü öffnen': 'Open menu',
  'Theme wechseln': 'Toggle theme',
  'Abmelden': 'Sign out',
  'Aktualisieren': 'Refresh',

  // Login
  'Benutzername': 'Username',
  'Passwort': 'Password',
  'Linux Server Management': 'Linux Server Management',

  // Dashboard
  'Noch keine Apps installiert': 'No apps installed yet',
  'Vault-Hub startet leer. Öffne den Store, um Funktionen als Plugins hinzuzufügen — z. B. SSH, Reverse-Proxy oder Virenschutz.':
    'Vault-Hub starts empty. Open the store to add features as plugins — e.g. SSH, reverse proxy or antivirus.',
  'Zum Store': 'Open store',

  // Store
  'Plugins installieren, aktualisieren, entfernen': 'Install, update and remove plugins',
  'Eigenes Plugin hinzufügen': 'Add your own plugin',
  'Hinzufügen': 'Add',
  'Store ist leer': 'Store is empty',
  'Es sind noch keine Apps im Store-Katalog. Füge oben ein eigenes Plugin per Git-URL hinzu.':
    'There are no apps in the store catalog yet. Add your own plugin via a Git URL above.',
  'System-Erweiterung': 'System extension',
  'App': 'App',
  'Installieren': 'Install',
  'Installiere…': 'Installing…',
  'Deinstallieren': 'Uninstall',

  // Settings – tabs & account
  'Account': 'Account',
  'Version & Updates': 'Version & updates',
  'Updatefähige Apps': 'Updatable apps',
  'Passwort ändern': 'Change password',
  'Aktuelles Passwort': 'Current password',
  'Neues Passwort': 'New password',
  'Neues Passwort bestätigen': 'Confirm new password',
  'Speichern': 'Save',
  'Passwort geändert.': 'Password changed.',
  'Neues Passwort zu kurz (min. 6 Zeichen).': 'New password too short (min. 6 characters).',
  'Passwörter stimmen nicht überein.': 'Passwords do not match.',
  'Fehler beim Ändern.': 'Failed to change password.',
  'Fehler': 'Error',

  // Settings – 2FA
  'Zwei-Faktor-Authentifizierung': 'Two-factor authentication',
  'Aktiv': 'Active',
  '2FA ist aktiv. Zum Deaktivieren Passwort eingeben.': '2FA is active. Enter your password to disable it.',
  '2FA deaktivieren': 'Disable 2FA',
  'QR-Code in der Authenticator-App scannen, dann 6-stelligen Code eingeben.':
    'Scan the QR code in your authenticator app, then enter the 6-digit code.',
  '6-stelliger Code': '6-digit code',
  'Aktivieren': 'Enable',
  'Zusätzliche Sicherheit per Authenticator-App (TOTP).': 'Extra security via authenticator app (TOTP).',
  '2FA einrichten': 'Set up 2FA',
  'Code ungültig': 'Invalid code',

  // Settings – language
  'Sprache': 'Language',
  'Basis: Deutsch & Englisch. Weitere Sprachen kommen modular über den Store.':
    'Base: German & English. More languages arrive modularly via the store.',

  // Settings – updates
  'Repository': 'Repository',
  'geprüft': 'checked',
  'Update verfügbar': 'Update available',
  'Aktuell': 'Up to date',
  'Prüfen': 'Check',
  'Jetzt aktualisieren': 'Update now',
  'Aktualisiere…': 'Updating…',

  // Settings – app updates
  'Alle Apps sind aktuell': 'All apps are up to date',
  'Installierte Plugins mit verfügbarem Update erscheinen hier.': 'Installed plugins with an available update appear here.',
  'Update(s) verfügbar': 'update(s) available',
  'Alle aktualisieren': 'Update all',

  // Plugin host
  'Plugin nicht gefunden oder nicht installiert.': 'Plugin not found or not installed.',

  // Settings – extensions & restart
  'Erweiterungen': 'Extensions',
  'Keine System-Erweiterungen installiert': 'No system extensions installed',
  'Installiere z. B. „SSH-Zugang" aus dem Store, dann erscheint hier der Schalter.':
    'Install e.g. "SSH access" from the store, then the switch appears here.',
  'Deaktivieren': 'Disable',
  'Inaktiv': 'Inactive',
  'Neustart erforderlich': 'Restart required',
  'Ein neu installiertes Plugin-Backend wird erst nach einem Neustart aktiv':
    'A newly installed plugin backend only becomes active after a restart',
  'Backend neu starten': 'Restart backend',
  'Starte neu…': 'Restarting…',
};
