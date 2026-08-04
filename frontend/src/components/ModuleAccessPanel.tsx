import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const MODULE_LABELS: Record<string, string> = {
  scheduling: 'Horaires', tasks: 'Tâches par quart', vacations: 'Vacances & congés', messages: 'Messagerie',
  team: 'Équipe', deliveries: 'Livraisons', training: 'Formations', sst: 'Santé & sécurité', benefits: 'Avantages',
  employees: 'Employés', payroll: 'Paie', licenses: 'Licences', recruitment: 'Recrutement', performance: 'Performance',
  onboarding: 'Accueil', contracts: 'Contrats', replacements: 'Remplacements', resources: 'Ressources', reports: 'Rapports & API',
};

export const ModuleAccessPanel = ({ employeeId }: { employeeId: string }): JSX.Element => {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [found, setFound] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      const r = await axios.get<{ found: boolean; email?: string; role?: string; module_overrides?: Record<string, boolean> }>(
        `${API}/users/by-employee/${employeeId}`, { headers: { Authorization: `Bearer ${token}` } });
      setFound(r.data.found);
      setEmail(r.data.email ?? '');
      setRole(r.data.role ?? '');
      setOverrides(r.data.module_overrides ?? {});
    } catch {
      setFound(false);
    }
  }, [token, employeeId]);

  useEffect(() => { void load(); }, [load]);

  const cycle = (key: string): void => {
    const cur = overrides[key];
    const next = { ...overrides };
    if (cur === undefined) next[key] = true;
    else if (cur === true) next[key] = false;
    else delete next[key];
    setOverrides(next);
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await axios.put(`${API}/users/by-employee/${employeeId}/modules`, { module_overrides: overrides }, { headers });
      toast.success('Accès aux modules mis à jour — appliqué à la prochaine connexion.');
    } catch {
      toast.error('Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  if (found === null) return <p className="text-sm text-slate-400 bg-white rounded-xl border border-slate-200 p-5">Chargement…</p>;
  if (!found) return <p className="text-sm text-slate-500 bg-white rounded-xl border border-slate-200 p-5" data-testid="module-access-no-account">Aucun compte utilisateur lié à cet employé.</p>;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6" data-testid="module-access-panel">
      <p className="text-xs text-slate-500 mb-1">Compte : <span className="font-semibold text-slate-700">{email}</span> ({role})</p>
      <p className="text-[11px] text-slate-400 mb-4">Cliquez pour alterner : <span className="text-slate-500">par défaut</span> → <span className="text-emerald-700">accordé</span> → <span className="text-red-600">retiré</span>.</p>
      <div className="flex flex-wrap gap-2">
        {Object.entries(MODULE_LABELS).map(([key, label]) => {
          const v = overrides[key];
          return (
            <button
              key={key}
              data-testid={`module-access-${key}`}
              onClick={() => cycle(key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                v === true ? 'bg-emerald-600 text-white border-emerald-600'
                : v === false ? 'bg-red-50 text-red-600 border-red-200 line-through'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <Button data-testid="module-access-save" size="sm" onClick={() => void save()} disabled={saving} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs mt-4">
        {saving ? 'Enregistrement…' : 'Enregistrer les accès'}
      </Button>
    </div>
  );
};
