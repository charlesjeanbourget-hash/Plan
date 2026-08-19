import { useState } from 'react';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileSpreadsheet, Download } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export const BudgetExportCard = (): JSX.Element => {
  const { state } = useHR();
  const { token } = useAuth();
  const [granularity, setGranularity] = useState<'biweekly' | 'monthly'>('biweekly');
  const [anchor, setAnchor] = useState(iso(new Date()));
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);

  const period = (): { start: string; end: string; label: string } => {
    if (granularity === 'monthly') {
      const [y, m] = month.split('-').map(Number);
      const start = `${month}-01`;
      const end = iso(new Date(y, m, 0));
      return { start, end, label: `Mois de ${new Date(y, m - 1, 1).toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' })}` };
    }
    const d0 = new Date(`${anchor}T00:00:00`);
    const d1 = new Date(d0);
    d1.setDate(d0.getDate() + 13);
    return { start: iso(d0), end: iso(d1), label: `Période de 2 semaines du ${iso(d0)} au ${iso(d1)}` };
  };

  const download = async (): Promise<void> => {
    setBusy(true);
    const { start, end, label } = period();
    const names: Record<string, string> = {};
    state.branches.forEach((b) => { names[b.id] = b.name; });
    try {
      const res = await fetch(
        `${API}/payroll/budget-export?start=${start}&end=${end}&label=${encodeURIComponent(label)}&names=${encodeURIComponent(JSON.stringify(names))}`,
        { headers: { Authorization: `Bearer ${token ?? ''}` } });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(err?.detail ?? 'Export impossible.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `budgets-paie_${start}_${end}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Export des budgets de paie téléchargé (CSV compatible Excel).');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-8 bg-white rounded-2xl border border-slate-200 shadow-sm p-5" data-testid="budget-export-card">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold mb-1 inline-flex items-center gap-1.5">
        <FileSpreadsheet className="w-3.5 h-3.5 text-bronze-600" /> Budgets de paie par succursale
      </p>
      <p className="text-xs text-slate-500 mb-4">
        Export CSV : heures et coûts planifiés vs réels (punchs), comparés au budget de chaque succursale, plus le total pharmacie.
        Astuce : définissez un budget hebdomadaire par succursale (Horaires → génération IA → budgets par succursale) pour remplir la colonne « Budget ».
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Période</Label>
          <Select value={granularity} onValueChange={(v) => setGranularity(v as 'biweekly' | 'monthly')}>
            <SelectTrigger data-testid="budget-export-granularity" className="w-44 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="biweekly">Aux 2 semaines</SelectItem>
              <SelectItem value="monthly">Mensuel</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {granularity === 'biweekly' ? (
          <div className="space-y-1">
            <Label className="text-xs">Début de la période</Label>
            <Input data-testid="budget-export-anchor" type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} className="h-9 w-44" />
          </div>
        ) : (
          <div className="space-y-1">
            <Label className="text-xs">Mois</Label>
            <Input data-testid="budget-export-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-44" />
          </div>
        )}
        <Button data-testid="budget-export-download" size="sm" onClick={() => void download()} disabled={busy} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs h-9">
          <Download className="w-3.5 h-3.5 mr-1" /> {busy ? 'Préparation…' : 'Exporter (CSV)'}
        </Button>
      </div>
    </div>
  );
};
