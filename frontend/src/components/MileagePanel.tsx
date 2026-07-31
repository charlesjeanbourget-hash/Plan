import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Fuel, Download, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface MileageCourier {
  courier_employee_id: string;
  courier_name: string;
  deliveries: number;
  days: number;
  km: number;
  unlocated: number;
}

interface MileageData {
  start_address: string;
  mileage_rate: number;
  couriers: MileageCourier[];
}

const isoLocal = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const monday = (offset: number): Date => {
  const d = new Date();
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff + offset * 7);
  return d;
};

const cad = (n: number): string => n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });

export const MileagePanel = (): JSX.Element => {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [weekOffset, setWeekOffset] = useState(0);
  const [data, setData] = useState<MileageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [rate, setRate] = useState('0.50');
  const [savingRate, setSavingRate] = useState(false);

  const start = isoLocal(monday(weekOffset));
  const endDate = monday(weekOffset);
  endDate.setDate(endDate.getDate() + 6);
  const end = isoLocal(endDate);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await axios.get<MileageData>(`${API}/deliveries/mileage?start=${start}&end=${end}`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setData(res.data);
      setRate(res.data.mileage_rate.toFixed(2));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [start, end, token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const rateNum = Number(rate.replace(',', '.')) || 0;

  const saveRate = async (): Promise<void> => {
    if (!data || rateNum <= 0 || rateNum > 5) {
      toast.error('Taux invalide (entre 0,01 et 5,00 $/km).');
      return;
    }
    setSavingRate(true);
    try {
      await axios.put(`${API}/pharmacy/settings`, { address: data.start_address, mileage_rate: rateNum }, { headers });
      toast.success(`Taux de remboursement enregistré : ${rateNum.toFixed(2)} $/km.`);
    } catch {
      toast.error('Enregistrement du taux impossible.');
    } finally {
      setSavingRate(false);
    }
  };

  const exportCsv = (): void => {
    if (!data) return;
    const lines = [
      `Semaine du ${start} au ${end}`,
      `Taux de remboursement,${rateNum.toFixed(2)} $/km`,
      '',
      'Livreur,Livraisons,Jours en tournée,Km estimés,Montant ($)',
      ...data.couriers.map((c) => `"${c.courier_name}",${c.deliveries},${c.days},${c.km},${(c.km * rateNum).toFixed(2)}`),
      `"TOTAL",${data.couriers.reduce((s, c) => s + c.deliveries, 0)},,${totalKm.toFixed(1)},${(totalKm * rateNum).toFixed(2)}`,
    ];
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kilometrage_${start}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Rapport CSV téléchargé.');
  };

  const totalKm = data?.couriers.reduce((s, c) => s + c.km, 0) ?? 0;
  const totalUnlocated = data?.couriers.reduce((s, c) => s + c.unlocated, 0) ?? 0;

  return (
    <div data-testid="mileage-panel">
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2">
              <Fuel className="w-4 h-4 text-bronze-600" /> Kilométrage des livreurs
            </h2>
            <p className="text-xs text-slate-500 mt-1">Km estimés à partir des tournées livrées — pour le remboursement d'essence.</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button data-testid="mileage-week-prev" onClick={() => setWeekOffset((o) => o - 1)} className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-500 hover:border-emerald-300 hover:text-emerald-700 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span data-testid="mileage-week-label" className="text-xs font-semibold text-slate-700 px-2 whitespace-nowrap">Semaine du {start} au {end}</span>
            <button data-testid="mileage-week-next" onClick={() => setWeekOffset((o) => o + 1)} className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-500 hover:border-emerald-300 hover:text-emerald-700 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3 mt-4 pt-4 border-t border-slate-100">
          <div>
            <p className="text-xs text-slate-500 font-semibold mb-1.5">Taux de remboursement ($/km)</p>
            <Input
              data-testid="mileage-rate-input"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
              className="w-28"
            />
          </div>
          <Button data-testid="mileage-save-rate" size="sm" variant="outline" className="rounded-full text-xs" onClick={() => void saveRate()} disabled={savingRate}>
            {savingRate ? 'Enregistrement…' : 'Enregistrer le taux'}
          </Button>
          <Button data-testid="mileage-export-csv" size="sm" className="rounded-full bg-bronze-600 hover:bg-bronze-700 text-white text-xs ml-auto" onClick={exportCsv} disabled={!data || data.couriers.length === 0}>
            <Download className="w-3.5 h-3.5 mr-1" /> Exporter CSV
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Calcul du kilométrage en cours…</p>
      ) : !data || data.couriers.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <p data-testid="mileage-empty" className="text-sm text-slate-500">Aucune livraison livrée cette semaine — rien à rembourser.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.12em] text-slate-500 border-b border-slate-200">
                <th className="px-5 py-3 font-semibold">Livreur</th>
                <th className="px-5 py-3 font-semibold">Livraisons</th>
                <th className="px-5 py-3 font-semibold">Jours en tournée</th>
                <th className="px-5 py-3 font-semibold">Km estimés</th>
                <th className="px-5 py-3 font-semibold">Montant</th>
              </tr>
            </thead>
            <tbody>
              {data.couriers.map((c) => (
                <tr key={c.courier_employee_id} data-testid={`mileage-row-${c.courier_employee_id}`} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 font-semibold text-slate-800">
                    {c.courier_name}
                    {c.unlocated > 0 && (
                      <span className="inline-flex items-center gap-1 ml-2 text-[11px] text-amber-700 font-normal">
                        <AlertTriangle className="w-3 h-3" /> {c.unlocated} adresse(s) non localisée(s)
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{c.deliveries}</td>
                  <td className="px-5 py-3 text-slate-600">{c.days}</td>
                  <td className="px-5 py-3 font-bold text-slate-800">{c.km.toLocaleString('fr-CA')} km</td>
                  <td className="px-5 py-3 font-bold text-emerald-700">{cad(c.km * rateNum)}</td>
                </tr>
              ))}
              <tr className="bg-slate-50">
                <td className="px-5 py-3 font-heading font-bold text-slate-900">Total</td>
                <td className="px-5 py-3 font-bold text-slate-700">{data.couriers.reduce((s, c) => s + c.deliveries, 0)}</td>
                <td className="px-5 py-3" />
                <td data-testid="mileage-total-km" className="px-5 py-3 font-bold text-slate-900">{totalKm.toLocaleString('fr-CA', { maximumFractionDigits: 1 })} km</td>
                <td data-testid="mileage-total-amount" className="px-5 py-3 font-extrabold text-emerald-700">{cad(totalKm * rateNum)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {totalUnlocated > 0 && (
        <p className="text-[11px] text-slate-400 mt-2">Les adresses non localisées sont exclues du calcul des km. Distances estimées par la route (à vol d'oiseau × 1,3) depuis {data?.start_address}.</p>
      )}
    </div>
  );
};
