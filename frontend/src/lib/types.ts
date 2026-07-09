// Vault-Hub-Kern-Typen. Feature-spezifische Typen bringen Plugins selbst mit.

export interface User {
  id: number;
  username: string;
  role: 'admin' | 'viewer';
  totpEnabled?: boolean;
}
