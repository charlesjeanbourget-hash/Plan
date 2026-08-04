import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface CustomField {
  id: string;
  label: string;
  type: 'texte' | 'date' | 'choix';
  options: string[];
}

export const CustomFieldsPanel = ({ employeeId }: { employeeId: string }): JSX.Element => {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [fields, setFields] = useState<CustomField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [manageOpen, setManageOpen] = useState(false);
  const [draft, setDraft] = useState<CustomField[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      const [f, p] = await Promise.all([
        axios.get<{ fields: CustomField[] }>(`${API}/hr/custom-fields`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get<{ custom_values?: Record<string, string> }>(`${API}/profiles/${employeeId}`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      setFields(f.data.fields);
      setValues(p.data.custom_values ?? {});
    } catch { /* hors ligne */ }
  }, [token, employeeId]);

  useEffect(() => { void load(); }, [load]);

  const saveValues = async (): Promise<void> => {
    setSaving(true);
    try {
      await axios.put(`${API}/profiles/${employeeId}`, { custom_values: values }, { headers });
      toast.success('Champs personnalisés enregistrés.');
    } catch {
      toast.error('Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  const saveDefs = async (): Promise<void> => {
    try {
      const r = await axios.put<{ fields: CustomField[] }>(`${API}/hr/custom-fields`, { fields: draft }, { headers });
      setFields(r.data.fields);
      setManageOpen(false);
      toast.success('Champs RH mis à jour pour toute la pharmacie.');
    } catch {
      toast.error('Enregistrement impossible.');
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6" data-testid="custom-fields-panel">
      <div className="flex justify-end mb-4">
        <Button data-testid="manage-custom-fields-button" size="sm" variant="outline" className="rounded-full text-xs" onClick={() => { setDraft(fields.map((f) => ({ ...f }))); setManageOpen(true); }}>
          <Settings2 className="w-3.5 h-3.5 mr-1" /> Gérer les champs
        </Button>
      </div>
      {fields.length === 0 ? (
        <p className="text-sm text-slate-500" data-testid="custom-fields-empty">
          Aucun champ personnalisé défini. Créez vos propres champs RH (taille d'uniforme, allergies, n° de casier…) — ils s'appliquent à tous les dossiers.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {fields.map((f) => (
              <div key={f.id} className="space-y-1.5">
                <Label>{f.label}</Label>
                {f.type === 'choix' ? (
                  <Select value={values[f.id] ?? ''} onValueChange={(v) => setValues({ ...values, [f.id]: v })}>
                    <SelectTrigger data-testid={`custom-field-${f.id}`}><SelectValue placeholder="Choisir…" /></SelectTrigger>
                    <SelectContent>{f.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input
                    data-testid={`custom-field-${f.id}`}
                    type={f.type === 'date' ? 'date' : 'text'}
                    value={values[f.id] ?? ''}
                    onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}
                  />
                )}
              </div>
            ))}
          </div>
          <Button data-testid="custom-fields-save" size="sm" onClick={() => void saveValues()} disabled={saving} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs mt-4">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </>
      )}

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent data-testid="custom-fields-dialog" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading">Champs RH personnalisés</DialogTitle>
            <DialogDescription>Définis pour toute la pharmacie — visibles dans chaque dossier employé (max 12).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {draft.map((f, i) => (
              <div key={f.id} className="flex gap-2 items-center">
                <Input
                  data-testid={`field-label-input-${i}`}
                  value={f.label}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  placeholder="Nom du champ"
                  className="flex-1 h-9"
                />
                <Select value={f.type} onValueChange={(v) => setDraft(draft.map((x, j) => (j === i ? { ...x, type: v as CustomField['type'] } : x)))}>
                  <SelectTrigger className="w-24 h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="texte">Texte</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="choix">Choix</SelectItem>
                  </SelectContent>
                </Select>
                {f.type === 'choix' && (
                  <Input
                    value={f.options.join(', ')}
                    onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, options: e.target.value.split(',').map((o) => o.trim()) } : x)))}
                    placeholder="Option1, Option2"
                    className="w-36 h-9 text-xs"
                  />
                )}
                <button data-testid={`field-delete-${i}`} onClick={() => setDraft(draft.filter((_, j) => j !== i))} className="w-8 h-8 rounded-full text-slate-300 hover:text-red-600 hover:bg-red-50 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            {draft.length < 12 && (
              <Button data-testid="field-add-button" size="sm" variant="outline" className="rounded-full text-xs" onClick={() => setDraft([...draft, { id: crypto.randomUUID(), label: '', type: 'texte', options: [] }])}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Ajouter un champ
              </Button>
            )}
          </div>
          <Button data-testid="fields-save-button" onClick={() => void saveDefs()} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
            Enregistrer les champs
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};
