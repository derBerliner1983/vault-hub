import { lazy, type ComponentType } from 'react';
import { DashboardPage } from './DashboardPage';
import { TaskManagerPage } from './TaskManagerPage';
import { AntivirusPage } from './AntivirusPage';
import { UsersPage } from './UsersPage';
import { SystemUpdatesPage } from './SystemUpdatesPage';
import { PackagesPage } from './PackagesPage';
import { FileManagerPage } from './FileManagerPage';
import { SharesPage } from './SharesPage';
import { AutomationPage } from './AutomationPage';
import { BackupsPage } from './BackupsPage';
// Terminal lädt xterm (~290 KB) → lazy, damit es nur beim Öffnen geladen wird.
const TerminalPage = lazy(() => import('./TerminalPage').then((m) => ({ default: m.TerminalPage })));

// Native Feature-Seiten (aus Core-Hub portiert), pro Plugin-ID. Ist eine ID hier
// registriert UND das Plugin installiert, rendert die Shell diese native Seite
// (pixelgleich zu Core-Hub) statt des iframe-Fallbacks. Fremd-Plugins ohne native
// Seite laufen weiter über den iframe-Host.
export const pluginPages: Record<string, ComponentType> = {
  dashboard: DashboardPage,
  taskmanager: TaskManagerPage,
  antivirus: AntivirusPage,
  users: UsersPage,
  'system-updates': SystemUpdatesPage,
  packages: PackagesPage,
  filemanager: FileManagerPage,
  shares: SharesPage,
  automation: AutomationPage,
  backups: BackupsPage,
  terminal: TerminalPage,
};
