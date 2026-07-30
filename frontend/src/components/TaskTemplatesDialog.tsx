import { useState, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sunrise, Moon, ClipboardList, Plus, Repeat, LucideIcon } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const DAY_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const SHIFTS = ['Matin', 'Après-midi', 'Soir'];

interface TemplateItem {
  title: string;
  description: string;
}

interface Template {
  key: string;
  label: string;
  shift: string;
  icon: LucideIcon;
  items: TemplateItem[];
}

const TEMPLATES: Template[] = [
  {
    key: 'ouverture', label: 'Ouverture', shift: 'Matin', icon: Sunrise,
    items: [
      { title: "Désarmer l'alarme et déverrouiller la pharmacie", description: '' },
      { title: 'Vérifier et consigner les températures des réfrigérateurs (vaccins, insuline)', description: 'Registre des frigos' },
      { title: 'Démarrer les caisses et le système de pharmacie', description: '' },
      { title: 'Écouter la boîte vocale et traiter les renouvellements en attente', description: '' },
      { title: 'Vérifier les piluliers et ordonnances préparés la veille', description: '' },
      { title: 'Sortir les commandes reçues et ranger les produits réfrigérés en priorité', description: '' },
    ],
  },
  {
    key: 'fermeture', label: 'Fermeture', shift: 'Soir', icon: Moon,
    items: [
      { title: 'Compter et balancer la caisse', description: '' },
      { title: 'Ranger les narcotiques au coffre et compléter le registre', description: '' },
      { title: 'Vérifier et consigner les températures des réfrigérateurs', description: '' },
      { title: 'Préparer les piluliers et ordonnances du lendemain', description: '' },
      { title: 'Nettoyer et désinfecter les comptoirs et le laboratoire', description: '' },
      { title: "Armer l'alarme et verrouiller la pharmacie", description: '' },
    ],
  },
  {
    key: 'inventaire', label: 'Inventaire', shift: 'Après-midi', icon: ClipboardList,
    items: [
      { title: 'Compter les narcotiques et substances contrôlées', description: 'Registre obligatoire' },
      { title: 'Vérifier les dates de péremption de la section du jour', description: 'Rotation des stocks' },
      { title: "Passer la commande au grossiste avant l'heure limite", description: '' },
      { title: 'Placer la commande reçue et faire la rotation des tablettes', description: '' },
      { title: 'Signaler les ruptures de stock au pharmacien', description: '' },
    ],
  },
];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  days: string[];
  onCreated: () => Promise<void> | void;
}

export const TaskTemplatesDialog = ({ open, onOpenChange, days, onCreated }: Props): JSX.Element => {
  const { token } = useAuth();
  const [templateKey, setTemplateKey] = useState('ouverture');
  const [unchecked, setUnchecked] = useState<Record<number, boolean>>({});
  const [customs, setCustoms] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [date, setDate] = useState('');
  const [shift, setShift] = useState('Matin');
  const [recurring, setRecurring] = useState(false);
  const [busy, setBusy] = useState(false);

  const template = TEMPLATES.find((t) => t.key === templateKey) ?? TEMPLATES[0];
  const effectiveDate = date || days[0];

  const pickTemplate = (t: Template): void => {
    setTemplateKey(t.key);
    setShift(t.shift);
    setUnchecked({});
    setCustoms([]);
  };

  const addCustom = (): void => {
    if (!customInput.trim()) return;
    setCustoms((prev) => [...prev, customInput.trim()]);
    setCustomInput('');
  };

  const selectedCount = template.items.filter((_, i) => !unchecked[i]).length + customs.length;

  const fmtDay = (d: string, i: number): string => `${DAY_LABELS[i]} ${d.slice(8, 10)}/${d.slice(5, 7)}`;

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const items = [
      ...template.items.filter((_, i) => !unchecked[i]),
      ...customs.map((c) => ({ title: c, description: '' })),
    ];
    if (items.length === 0) {
      toast.error('Sélectionnez au moins une tâche.');
      return;
    }
    setBusy(true);
    try {
      const res = await axios.post<{ created: number }>(`${API}/tasks/bulk`, {
        date: effectiveDate, shift, recurring, items,
      }, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      toast.success(`${res.data.created} tâche(s) « ${template.label} » ajoutée(s)${recurring ? ' — elles reviendront chaque semaine.' : '.'}`);
      onOpenChange(false);
      setCustoms([]);
      setUnchecked({});
      setRecurring(false);
      await onCreated();
    } catch {
      toast.error('Ajout impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="template-dialog" className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">Modèles de tâches — pharmacie</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                data-testid={`template-pick-${t.key}`}
                onClick={() => pickTemplate(t)}
                className={`rounded-xl border p-3 text-center transition-colors ${
                  templateKey === t.key ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-bronze-300'
                }`}
              >
                <t.icon className={`w-5 h-5 mx-auto mb-1.5 ${templateKey === t.key ? 'text-emerald-600' : 'text-bronze-600'}`} />
                <span className="text-xs font-semibold text-slate-800">{t.label}</span>
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label>Tâches incluses (décochez celles à exclure)</Label>
            {template.items.map((item, i) => (
              <label key={item.title} className="flex items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2 cursor-pointer hover:border-emerald-300 transition-colors">
                <Checkbox
                  data-testid={`template-item-${i}`}
                  checked={!unchecked[i]}
                  onCheckedChange={(v) => setUnchecked((prev) => ({ ...prev, [i]: v !== true }))}
                  className="mt-0.5"
                />
                <span className="text-sm text-slate-700">
                  {item.title}
                  {item.description && <span className="block text-xs text-slate-400">{item.description}</span>}
                </span>
              </label>
            ))}
            {customs.map((c, i) => (
              <div key={`${c}-${i}`} data-testid={`template-custom-${i}`} className="flex items-center gap-2.5 rounded-lg border border-bronze-200 bg-bronze-50/50 px-3 py-2">
                <Checkbox checked disabled className="opacity-70" />
                <span className="text-sm text-slate-700 flex-1">{c}</span>
                <button type="button" onClick={() => setCustoms((prev) => prev.filter((_, ci) => ci !== i))} className="text-xs text-red-500 hover:text-red-700">
                  Retirer
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                data-testid="template-custom-input"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
                placeholder="Ajouter une tâche à la liste…"
              />
              <Button type="button" data-testid="template-add-custom" variant="outline" onClick={addCustom} className="rounded-full shrink-0">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Jour</Label>
              <Select value={effectiveDate} onValueChange={setDate}>
                <SelectTrigger data-testid="template-day-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {days.map((d, i) => <SelectItem key={d} value={d}>{fmtDay(d, i)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quart</Label>
              <Select value={shift} onValueChange={setShift}>
                <SelectTrigger data-testid="template-shift-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 cursor-pointer hover:border-bronze-300 transition-colors">
            <Checkbox data-testid="template-recurring-checkbox" checked={recurring} onCheckedChange={(v) => setRecurring(v === true)} className="mt-0.5" />
            <span className="text-sm text-slate-700">
              <span className="font-semibold inline-flex items-center gap-1.5"><Repeat className="w-3.5 h-3.5 text-bronze-600" /> Répéter ces tâches chaque semaine</span>
            </span>
          </label>

          <Button data-testid="template-submit" type="submit" disabled={busy || selectedCount === 0} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
            {busy ? 'Ajout en cours…' : `Ajouter ${selectedCount} tâche(s) au quart ${shift}`}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
