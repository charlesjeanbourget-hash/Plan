import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { EmployeeProfile, WeekDayKey } from '@/types';
import { PHARMACY_ROLES, PHARMACY_TASKS, PHARMACY_RESTRICTIONS, DAY_KEYS, DAY_NAMES, DEPARTMENTS } from '@/lib/pharmacy';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserCog, KeyRound, Save, Plus } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface Props {
  employeeId: string;
  employeeName: string;
  canManageCode: boolean;
}

const Chip = ({ label, active, onToggle, testId }: { label: string; active: boolean; onToggle: () => void; testId: string }): JSX.Element => (
  <button
    type="button"
    data-testid={testId}
    onClick={onToggle}
    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
      active ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'
    }`}
  >
    {label}
  </button>
);

export const ProfileEditor = ({ employeeId, employeeName, canManageCode }: Props): JSX.Element => {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [customRestriction, setCustomRestriction] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<EmployeeProfile>(
        `${API}/profiles/${employeeId}?employee_name=${encodeURIComponent(employeeName)}`, { headers });
      setProfile(res.data);
    } catch {
      toast.error('Impossible de charger le profil.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  useEffect(() => { void load(); }, [load]);

  if (!profile) {
    return <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">Chargement du profil…</div>;
  }

  const patch = (p: Partial<EmployeeProfile>): void => setProfile({ ...profile, ...p });

  const toggleIn = (field: 'roles' | 'capacities' | 'restrictions', value: string): void => {
    const list = profile[field];
    patch({ [field]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] } as Partial<EmployeeProfile>);
  };

  const patchDay = (day: WeekDayKey, p: Partial<{ available: boolean; start: string; end: string }>): void =>
    patch({ availability: { ...profile.availability, [day]: { ...profile.availability[day], ...p } } });

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await axios.put(`${API}/profiles/${employeeId}`, {
        employee_name: employeeName,
        roles: profile.roles,
        capacities: profile.capacities,
        restrictions: profile.restrictions,
        min_hours_week: profile.min_hours_week,
        max_hours_week: profile.max_hours_week,
        availability: profile.availability,
        notes: profile.notes,
        payroll_number: profile.payroll_number ?? '',
        department: profile.department ?? '',
      }, { headers });
      toast.success('Profil enregistré — il sera pris en compte par l\'IA pour les horaires.');
    } catch {
      toast.error('Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  const generateCode = async (): Promise<void> => {
    try {
      const res = await axios.post<{ punch_code: string }>(`${API}/profiles/${employeeId}/punch-code`, {}, { headers });
      patch({ punch_code_set: true });
      toast.success(`Nouveau NIP de punch : ${res.data.punch_code} — notez-le, il ne sera plus jamais affiché.`, { duration: 12000 });
    } catch {
      toast.error('Génération du NIP impossible.');
    }
  };

  const addCustomRestriction = (): void => {
    const v = customRestriction.trim();
    if (!v || profile.restrictions.includes(v)) return;
    patch({ restrictions: [...profile.restrictions, v] });
    setCustomRestriction('');
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-7" data-testid={`profile-editor-${employeeId}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2">
          <UserCog className="w-4 h-4 text-emerald-600" /> Profil, disponibilités et capacités
        </h2>
        <div className="flex items-center gap-3">
          <span data-testid="punch-code-display" className="inline-flex items-center gap-1.5 text-xs font-semibold bg-slate-100 text-slate-700 rounded-full px-3 py-1.5">
            <KeyRound className="w-3.5 h-3.5" /> NIP de punch : <span className="font-mono text-sm">{profile.punch_code_set ? '•••• (attribué)' : '— non attribué —'}</span>
          </span>
          {canManageCode && (
            <Button data-testid="generate-punch-code-button" size="sm" variant="outline" onClick={() => void generateCode()} className="rounded-full text-xs">
              {profile.punch_code_set ? 'Réinitialiser le NIP' : 'Générer un NIP'}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold mb-3">Disponibilités par jour</p>
          <div className="space-y-2">
            {DAY_KEYS.map((d) => {
              const day = profile.availability[d];
              return (
                <div key={d} className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <Switch
                    data-testid={`availability-toggle-${d}`}
                    checked={day.available}
                    onCheckedChange={(v: boolean) => patchDay(d, { available: v })}
                  />
                  <span className={`w-16 sm:w-20 text-sm font-semibold ${day.available ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{DAY_NAMES[d]}</span>
                  <Input type="time" className="w-24 sm:w-28 h-8 text-xs" disabled={!day.available} value={day.start} onChange={(e) => patchDay(d, { start: e.target.value })} />
                  <span className="text-slate-400 text-xs">à</span>
                  <Input type="time" className="w-24 sm:w-28 h-8 text-xs" disabled={!day.available} value={day.end} onChange={(e) => patchDay(d, { end: e.target.value })} />
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-4 mt-6">
            <div className="space-y-2">
              <Label>Heures min. / semaine</Label>
              <Input data-testid="min-hours-input" type="number" min={0} max={60} value={profile.min_hours_week} onChange={(e) => patch({ min_hours_week: Number(e.target.value) })} />
            </div>
            <div className="space-y-2">
              <Label>Heures max. / semaine</Label>
              <Input data-testid="max-hours-input" type="number" min={0} max={80} value={profile.max_hours_week} onChange={(e) => patch({ max_hours_week: Number(e.target.value) })} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Département par défaut</Label>
              <Select value={profile.department || 'Général'} onValueChange={(v) => patch({ department: v })}>
                <SelectTrigger data-testid="profile-dept-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-400">Les nouveaux quarts de cet employé se classeront automatiquement dans ce département (modifiable au cas par cas).</p>
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Matricule paie (numéro d'employé dans votre logiciel de paie)</Label>
              <Input
                data-testid="payroll-number-input"
                value={profile.payroll_number ?? ''}
                onChange={(e) => patch({ payroll_number: e.target.value })}
                placeholder="Ex. 000123 — utilisé par les exports Employeur D, Nethris et ADP"
              />
            </div>
          </div>
          <div className="space-y-2 mt-6">
            <Label>Notes (visibles par l'IA d'horaires)</Label>
            <Textarea data-testid="profile-notes-input" rows={2} value={profile.notes} onChange={(e) => patch({ notes: e.target.value })} placeholder="Ex. préfère les quarts de jour, en formation le mardi soir…" />
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold mb-3">Rôles ({profile.roles.length})</p>
            <div className="flex flex-wrap gap-1.5">
              {PHARMACY_ROLES.map((r) => (
                <Chip key={r} label={r} active={profile.roles.includes(r)} onToggle={() => toggleIn('roles', r)} testId={`role-chip-${PHARMACY_ROLES.indexOf(r)}`} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold mb-3">Capacités et tâches maîtrisées ({profile.capacities.length})</p>
            <div className="flex flex-wrap gap-1.5">
              {PHARMACY_TASKS.map((t) => (
                <Chip key={t} label={t} active={profile.capacities.includes(t)} onToggle={() => toggleIn('capacities', t)} testId={`task-chip-${PHARMACY_TASKS.indexOf(t)}`} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold mb-3">Restrictions ({profile.restrictions.length})</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {PHARMACY_RESTRICTIONS.map((r) => (
                <Chip key={r} label={r} active={profile.restrictions.includes(r)} onToggle={() => toggleIn('restrictions', r)} testId={`restriction-chip-${PHARMACY_RESTRICTIONS.indexOf(r)}`} />
              ))}
              {profile.restrictions.filter((r) => !PHARMACY_RESTRICTIONS.includes(r)).map((r) => (
                <Chip key={r} label={`${r} ✕`} active onToggle={() => toggleIn('restrictions', r)} testId={`custom-restriction-${r}`} />
              ))}
            </div>
            <div className="flex gap-2">
              <Input data-testid="custom-restriction-input" value={customRestriction} onChange={(e) => setCustomRestriction(e.target.value)} placeholder="Autre restriction…" className="h-9 text-sm" />
              <Button type="button" data-testid="add-restriction-button" size="sm" variant="outline" onClick={addCustomRestriction} className="rounded-full">
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Button data-testid="save-profile-button" disabled={saving} onClick={() => void save()} className="mt-8 rounded-full bg-emerald-600 hover:bg-emerald-700">
        <Save className="w-4 h-4 mr-1" /> {saving ? 'Enregistrement…' : 'Enregistrer le profil'}
      </Button>
    </div>
  );
};
