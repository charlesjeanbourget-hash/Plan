import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2 } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface Policy {
  mfa_required: boolean;
  pw_min_length: number;
  pw_require_upper: boolean;
  pw_require_lower: boolean;
  pw_require_digit: boolean;
  pw_require_special: boolean;
  pw_expiry_days: number;
}

const RULES: { key: 'pw_require_upper' | 'pw_require_lower' | 'pw_require_digit' | 'pw_require_special'; label: string }[] = [
  { key: 'pw_require_upper', label: 'Majuscule requise' },
  { key: 'pw_require_lower', label: 'Minuscule requise' },
  { key: 'pw_require_digit', label: 'Chiffre requis' },
  { key: 'pw_require_special', label: 'Caractère spécial requis' },
];

export const SecurityPolicyPanel = (): JSX.Element | null => {
  const { currentUser, token } = useAuth();
  const isOrgAdmin = (currentUser?.role === 'admin' || currentUser?.role === 'manager') && !!currentUser?.pharmacyId;
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOrgAdmin || !token) return;
    axios.get<Policy>(`${API}/security-settings`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setPolicy(r.data))
      .catch(() => undefined);
  }, [isOrgAdmin, token]);

  if (!isOrgAdmin || !policy) return null;

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await axios.put<Policy>(`${API}/security-settings`, policy, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setPolicy(r.data);
      toast.success('Politique de sécurité de la pharmacie mise à jour.');
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Enregistrement impossible pour le moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-slate-200 pt-4 mt-1" data-testid="security-policy-panel">
      <p className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
        <Building2 className="w-4 h-4 text-emerald-600" /> Politique de sécurité de la pharmacie
      </p>
      <p className="text-xs text-slate-500 mt-1">Ces règles s'appliquent à tous les comptes de votre pharmacie.</p>
      <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5">
          <span className="text-xs font-semibold text-slate-700">Exiger la MFA pour toute l'équipe</span>
          <Switch data-testid="policy-mfa-required" checked={policy.mfa_required} onCheckedChange={(v) => setPolicy({ ...policy, mfa_required: v })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Longueur min. du mot de passe</Label>
            <Input data-testid="policy-min-length" type="number" min={8} max={64} value={policy.pw_min_length}
              onChange={(e) => setPolicy({ ...policy, pw_min_length: Number(e.target.value) || 10 })} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Expiration du mot de passe</Label>
            <Select value={String(policy.pw_expiry_days)} onValueChange={(v) => setPolicy({ ...policy, pw_expiry_days: Number(v) })}>
              <SelectTrigger data-testid="policy-expiry-select" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Jamais</SelectItem>
                <SelectItem value="90">90 jours</SelectItem>
                <SelectItem value="180">180 jours</SelectItem>
                <SelectItem value="365">1 an</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {RULES.map((r) => (
            <label key={r.key} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 gap-2">
              <span className="text-[11px] font-semibold text-slate-600">{r.label}</span>
              <Switch data-testid={`policy-${r.key}`} checked={policy[r.key]} onCheckedChange={(v) => setPolicy({ ...policy, [r.key]: v })} />
            </label>
          ))}
        </div>
        <Button data-testid="policy-save-button" size="sm" onClick={() => void save()} disabled={busy} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
          {busy ? 'Enregistrement…' : 'Enregistrer la politique'}
        </Button>
      </div>
    </div>
  );
};
