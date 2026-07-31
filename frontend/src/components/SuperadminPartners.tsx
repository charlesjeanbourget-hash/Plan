import { useState, useEffect, useCallback, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { GlobalPartner, POSITIONS } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe, Plus, Trash2, Building2, UserRound } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const SuperadminPartners = (): JSX.Element => {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [partners, setPartners] = useState<GlobalPartner[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [type, setType] = useState('agency');
  const [roles, setRoles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<GlobalPartner[]>(`${API}/superadmin/partners`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setPartners(res.data);
    } catch {
      setPartners([]);
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggleRole = (r: string): void => {
    setRoles((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]);
  };

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (roles.length === 0) {
      toast.error('Sélectionnez au moins un poste couvert.');
      return;
    }
    setBusy(true);
    try {
      await axios.post(`${API}/superadmin/partners`, { name, email, roles, partner_type: type }, { headers });
      toast.success(`Partenaire « ${name} » ajouté — il recevra les demandes de remplacement de toutes les pharmacies.`);
      setName(''); setEmail(''); setRoles([]); setType('agency'); setFormOpen(false);
      await refresh();
    } catch {
      toast.error('Ajout impossible.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: GlobalPartner): Promise<void> => {
    try {
      await axios.delete(`${API}/superadmin/partners/${p.id}`, { headers });
      toast.success(`Partenaire « ${p.name} » retiré.`);
      await refresh();
    } catch {
      toast.error('Suppression impossible.');
    }
  };

  return (
    <div data-testid="superadmin-partners-panel" className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2">
          <Globe className="w-4 h-4 text-bronze-600" /> Partenaires de remplacement globaux
        </h2>
        <Button data-testid="add-partner-button" size="sm" onClick={() => setFormOpen(!formOpen)} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
          <Plus className="w-3.5 h-3.5 mr-1" /> Ajouter un partenaire
        </Button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Agences ou remplaçants individuels inclus automatiquement dans les courriels de demandes de remplacement
        de <span className="font-semibold text-slate-700">toutes les pharmacies</span>, en plus des agences locales de chaque administrateur.
      </p>

      {formOpen && (
        <form onSubmit={(e) => void submit(e)} className="rounded-xl border border-bronze-200 bg-bronze-50/40 p-4 mb-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger data-testid="partner-type-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="agency">Agence de placement</SelectItem>
                  <SelectItem value="individual">Remplaçant(e) individuel(le)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{type === 'agency' ? 'Nom de l\'agence' : 'Nom du remplaçant'}</Label>
              <Input data-testid="partner-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'agency' ? 'Ex. PharmaStaff Québec' : 'Ex. Marie Dubois'} required />
            </div>
            <div className="space-y-2">
              <Label>Courriel</Label>
              <Input data-testid="partner-email-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@exemple.com" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Postes couverts</Label>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {POSITIONS.map((p) => (
                <label key={p} className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <Checkbox data-testid={`partner-role-${p}`} checked={roles.includes(p)} onCheckedChange={() => toggleRole(p)} /> {p}
                </label>
              ))}
            </div>
          </div>
          <Button data-testid="partner-submit-button" type="submit" disabled={busy} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
            {busy ? 'Ajout…' : 'Ajouter au réseau global'}
          </Button>
        </form>
      )}

      {partners.length === 0 ? (
        <p data-testid="partners-empty" className="text-sm text-slate-400">Aucun partenaire global pour l'instant.</p>
      ) : (
        <div className="space-y-2.5">
          {partners.map((p) => (
            <div key={p.id} data-testid={`partner-card-${p.id}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-4 py-3">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${p.partner_type === 'agency' ? 'bg-sky-100 text-sky-800' : 'bg-bronze-100 text-bronze-800'}`}>
                {p.partner_type === 'agency' ? <Building2 className="w-3 h-3" /> : <UserRound className="w-3 h-3" />}
                {p.partner_type === 'agency' ? 'Agence' : 'Remplaçant(e)'}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                <p className="text-xs text-slate-500">{p.email}</p>
              </div>
              <div className="flex flex-wrap gap-1 ml-auto">
                {p.roles.map((r) => (
                  <span key={r} className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600">{r}</span>
                ))}
              </div>
              <button data-testid={`partner-delete-${p.id}`} onClick={() => void remove(p)} className="text-slate-300 hover:text-red-500 transition-colors" aria-label="Supprimer">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
