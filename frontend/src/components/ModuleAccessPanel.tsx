import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { roleForPosition } from '@/lib/accountRole';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserPlus, Loader2, AlertTriangle } from 'lucide-react';
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
  const { state } = useHR();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [found, setFound] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const emp = state.employees.find((e) => e.id === employeeId);
  const [createEmail, setCreateEmail] = useState('');
  const [createRole, setCreateRole] = useState<'employee' | 'manager'>('employee');
  const [creating, setCreating] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

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

  useEffect(() => {
    if (!emp) return;
    setCreateEmail(emp.email.trim());
    const derived = roleForPosition(emp.position);
    setCreateRole(derived === 'employee' ? 'employee' : 'manager');
    setTempPassword(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const createAccount = async (): Promise<void> => {
    setCreating(true);
    try {
      const r = await axios.post<{ email_sent: boolean; temporary_password: string | null }>(
        `${API}/accounts/for-employee`,
        { employee_id: employeeId, email: createEmail.trim(), name: emp ? `${emp.firstName} ${emp.lastName}` : '', role: createRole },
        { headers });
      if (r.data.email_sent) {
        toast.success(`Compte créé — invitation envoyée par courriel à ${createEmail.trim()}.`, { duration: 8000 });
      } else {
        setTempPassword(r.data.temporary_password ?? null);
        toast.warning('Compte créé, mais le courriel a échoué — transmettez le mot de passe temporaire affiché.', { duration: 8000 });
      }
      await load();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: string }).detail : null;
      toast.error(detail ?? 'Création du compte impossible.');
    } finally {
      setCreating(false);
    }
  };

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
  if (!found) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4" data-testid="module-access-no-account">
        <div>
          <p className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-emerald-600" /> Cet employé n&apos;a pas encore de compte de connexion
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Créez-lui un compte : il recevra un courriel d&apos;invitation avec un mot de passe temporaire à changer à sa première connexion.
            Vous pourrez ensuite personnaliser ses accès aux modules ici.
          </p>
        </div>
        {tempPassword && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 inline-flex items-center gap-2" data-testid="create-account-temp-password">
            <AlertTriangle className="w-4 h-4 shrink-0" /> Courriel non livré — mot de passe temporaire : <span className="font-mono font-bold">{tempPassword}</span>
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-3 items-end">
          <div className="space-y-1.5">
            <Label className="text-xs">Courriel de l&apos;employé</Label>
            <Input
              data-testid="create-account-email-input"
              type="email"
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
              placeholder="employe@exemple.ca"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Rôle du compte</Label>
            <Select value={createRole} onValueChange={(v) => setCreateRole(v as 'employee' | 'manager')}>
              <SelectTrigger data-testid="create-account-role-select" className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">Employé</SelectItem>
                <SelectItem value="manager">Gestionnaire</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            data-testid="create-account-button"
            disabled={creating || !createEmail.trim()}
            onClick={() => void createAccount()}
            className="rounded-full bg-emerald-600 hover:bg-emerald-700 h-9"
          >
            {creating ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Création…</> : 'Créer le compte et envoyer l\'invitation'}
          </Button>
        </div>
      </div>
    );
  }

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
