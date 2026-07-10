import type { ComponentType } from 'react';
import { DashboardPage } from './DashboardPage';
import { TaskManagerPage } from './TaskManagerPage';
import { AntivirusPage } from './AntivirusPage';

// Native Feature-Seiten (aus Core-Hub portiert), pro Plugin-ID. Ist eine ID hier
// registriert UND das Plugin installiert, rendert die Shell diese native Seite
// (pixelgleich zu Core-Hub) statt des iframe-Fallbacks. Fremd-Plugins ohne native
// Seite laufen weiter über den iframe-Host.
export const pluginPages: Record<string, ComponentType> = {
  dashboard: DashboardPage,
  taskmanager: TaskManagerPage,
  antivirus: AntivirusPage,
};
