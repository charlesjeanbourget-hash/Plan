export type AccountRole = 'admin' | 'manager' | 'employee';

export const roleForPosition = (position: string): AccountRole => {
  const p = position.toLowerCase();
  if (p.includes('propriétaire')) return 'admin';
  if (p.includes('pharmacien') || p.includes('chef') || p.includes('superviseur') || p.includes('gérant')) return 'manager';
  return 'employee';
};

export const ACCOUNT_ROLE_LABELS: Record<AccountRole, string> = {
  admin: 'Administrateur',
  manager: 'Gestionnaire',
  employee: 'Employé',
};
