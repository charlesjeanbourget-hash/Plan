import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { WorkStation, RushPeriod } from '@/types';
import { DEPARTMENTS } from '@/lib/pharmacy';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const DAY_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  stations: WorkStation[];
  rushPeriods: RushPeriod[];
  onSaved: (stations: WorkStation[], periods: RushPeriod[]) => void;
}

export const WorkStationsDialog = ({ open, onOpenChange, stations, rushPeriods, onSaved }: Props): JSX.Element => {
  const { token } = useAuth();
  const [dept, setDept] = useState('Laboratoire');
  const [items, setItems] = useState<WorkStation[]>([]);
  const [periods, setPeriods] = useState<RushPeriod[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setItems(stations.map((s) => ({ ...s })));
      setPeriods(rushPeriods.map((p) => ({ ...p, days: [...p.days] })));
    }
  }, [open, stations, rushPeriods]);

  const deptItems = items.filter((s) => s.department === dept);
  const patchItem = (id: string, patch: Partial<WorkStation>): void =>
    setItems((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const addStation = (): void =>
    setItems((prev) => [...prev, {
      id: `custom-${Date.now()}`, department: dept, name: '', competence: '',
      normal_count: 1, rush_count: 1, active: true,
    }]);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const res = await axios.put<{ stations: WorkStation[]; rush_periods: RushPeriod[] }>(`${API}/work-stations`,
        { stations: items.filter((s) => s.name.trim()), rush_periods: periods },
        { headers: { Authorization: `Bearer ${token ?? ''}` } });
      onSaved(res.data.stations, res.data.rush_periods);
      toast.success('Postes et périodes de rush enregistrés pour votre pharmacie.');
      onOpenChange(false);
    } catch {
      toast.error("Impossible d'enregistrer la configuration.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="work-stations-dialog" className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">Postes de travail par département</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-500 -mt-2">
          Définissez les rôles de chaque département, le nombre de personnes requis en période normale et en période de rush.
          Ces réglages sont propres à votre pharmacie et guident l'attribution automatique selon les compétences.
        </p>
        <Select value={dept} onValueChange={setDept}>
          <SelectTrigger data-testid="stations-dept-select" className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DEPARTMENTS.map((d) => {
              const n = items.filter((s) => s.department === d && s.active).length;
              return <SelectItem key={d} value={d}>{d} ({n} actif{n > 1 ? 's' : ''})</SelectItem>;
            })}
          </SelectContent>
        </Select>
        <div className="space-y-2">
          <div className="hidden sm:grid grid-cols-[1fr,72px,72px,56px,32px] gap-2 text-[10px] uppercase tracking-[0.15em] text-slate-400 font-semibold px-1">
            <span>Poste / compétence requise</span><span className="text-center">Normal</span><span className="text-center">Rush</span><span className="text-center">Actif</span><span />
          </div>
          {deptItems.map((s) => (
            <div key={s.id} data-testid={`station-cfg-${s.id}`} className={`grid grid-cols-1 sm:grid-cols-[1fr,72px,72px,56px,32px] gap-2 items-center rounded-lg border px-2 py-2 ${s.active ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200'}`}>
              <div className="space-y-1">
                <Input data-testid={`station-name-${s.id}`} value={s.name} placeholder="Nom du poste" className="h-8 text-sm"
                  onChange={(e) => patchItem(s.id, { name: e.target.value })} />
                <Input value={s.competence} placeholder="Compétence requise (facultatif)" className="h-7 text-xs"
                  onChange={(e) => patchItem(s.id, { competence: e.target.value })} />
              </div>
              <Input data-testid={`station-normal-${s.id}`} type="number" min={0} max={20} value={s.normal_count} className="h-8 text-center"
                onChange={(e) => patchItem(s.id, { normal_count: Number(e.target.value) })} />
              <Input data-testid={`station-rush-${s.id}`} type="number" min={0} max={20} value={s.rush_count} className="h-8 text-center"
                onChange={(e) => patchItem(s.id, { rush_count: Number(e.target.value) })} />
              <div className="flex justify-center">
                <Switch data-testid={`station-active-${s.id}`} checked={s.active} onCheckedChange={(v: boolean) => patchItem(s.id, { active: v })} />
              </div>
              <button data-testid={`station-delete-${s.id}`} onClick={() => setItems((prev) => prev.filter((x) => x.id !== s.id))}
                className="text-slate-300 hover:text-red-500 transition-colors justify-self-center" aria-label="Supprimer le poste">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <Button data-testid="add-station-button" size="sm" variant="outline" className="rounded-full text-xs" onClick={addStation}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Ajouter un poste dans « {dept} »
          </Button>
        </div>
        <div className="pt-3 border-t border-slate-100 space-y-2">
          <p className="text-sm font-bold text-slate-800">Périodes de rush (communes à la pharmacie)</p>
          {periods.map((p, i) => (
            <div key={i} data-testid={`rush-period-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <div className="flex gap-1">
                {DAY_SHORT.map((lbl, d) => {
                  const on = p.days.includes(d);
                  return (
                    <button key={d} data-testid={`rush-day-${i}-${d}`} type="button"
                      onClick={() => setPeriods((prev) => prev.map((x, xi) => xi === i
                        ? { ...x, days: on ? x.days.filter((y) => y !== d) : [...x.days, d].sort() } : x))}
                      className={`w-7 h-7 rounded-full text-[11px] font-bold border transition-colors ${on ? 'bg-bronze-600 border-bronze-600 text-white' : 'bg-white border-slate-200 text-slate-500'}`}>
                      {lbl}
                    </button>
                  );
                })}
              </div>
              <Input type="time" value={p.start} className="h-8 w-28"
                onChange={(e) => setPeriods((prev) => prev.map((x, xi) => (xi === i ? { ...x, start: e.target.value } : x)))} />
              <span className="text-xs text-slate-400">à</span>
              <Input type="time" value={p.end} className="h-8 w-28"
                onChange={(e) => setPeriods((prev) => prev.map((x, xi) => (xi === i ? { ...x, end: e.target.value } : x)))} />
              <button onClick={() => setPeriods((prev) => prev.filter((_, xi) => xi !== i))}
                className="text-slate-300 hover:text-red-500 transition-colors ml-auto" aria-label="Supprimer la période">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <Button data-testid="add-rush-period-button" size="sm" variant="outline" className="rounded-full text-xs"
            onClick={() => setPeriods((prev) => [...prev, { days: [0, 1, 2, 3, 4], start: '10:00', end: '14:00' }])}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Ajouter une période de rush
          </Button>
        </div>
        <Button data-testid="save-stations-button" onClick={() => void save()} disabled={saving}
          className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
          {saving ? 'Enregistrement…' : 'Enregistrer la configuration'}
        </Button>
      </DialogContent>
    </Dialog>
  );
};
