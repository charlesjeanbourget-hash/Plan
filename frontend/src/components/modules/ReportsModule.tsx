import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { ModuleHeader, CollapsibleSection } from '@/components/modules/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Star, Send, KeyRound, Plug, Trash2, Copy, Upload } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface ReportItem { id: string; title: string; desc: string }
interface ApiKey { id: string; label: string; prefix: string; last_used_at: string | null; created_at: string }

const FREQ_LABELS: Record<string, string> = { off: 'Aucun envoi', hebdo: 'Chaque lundi', mensuel: 'Le 1er du mois' };
const DAY_MAP: Record<string, string> = {
  lundi: 'mon', mardi: 'tue', mercredi: 'wed', jeudi: 'thu', vendredi: 'fri', samedi: 'sat', dimanche: 'sun',
  mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri', sat: 'sat', sun: 'sun',
};

export default function ReportsModule(): JSX.Element {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [catalog, setCatalog] = useState<ReportItem[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [schedules, setSchedules] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyLabel, setNewKeyLabel] = useState('Caisse POS');
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!token) return;
    const h = { headers: { Authorization: `Bearer ${token}` } };
    try {
      const [r, k] = await Promise.all([
        axios.get<{ catalog: ReportItem[]; favorites: string[]; schedules: Record<string, string> }>(`${API}/reports`, h),
        axios.get<ApiKey[]>(`${API}/dev/keys`, h),
      ]);
      setCatalog(r.data.catalog);
      setFavorites(r.data.favorites);
      setSchedules(r.data.schedules);
      setKeys(k.data);
    } catch { /* hors ligne */ }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggleFav = async (id: string): Promise<void> => {
    setFavorites(favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id]);
    await axios.post(`${API}/reports/${id}/favorite`, {}, { headers }).catch(() => undefined);
  };

  const setSchedule = async (id: string, freq: string): Promise<void> => {
    try {
      await axios.put(`${API}/reports/${id}/schedule`, { frequency: freq }, { headers });
      setSchedules({ ...schedules, [id]: freq });
      toast.success(freq === 'off' ? 'Envoi programmé désactivé.' : `Rapport programmé : ${FREQ_LABELS[freq].toLowerCase()} par courriel aux gestionnaires.`);
    } catch {
      toast.error('Enregistrement impossible.');
    }
  };

  const sendNow = async (id: string): Promise<void> => {
    setSending(id);
    try {
      const r = await axios.post<{ sent_to: string }>(`${API}/reports/${id}/send`, {}, { headers });
      toast.success(`Rapport envoyé à ${r.data.sent_to}.`);
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Envoi impossible.');
    } finally {
      setSending(null);
    }
  };

  const createKey = async (): Promise<void> => {
    try {
      const r = await axios.post<ApiKey & { key: string }>(`${API}/dev/keys`, { label: newKeyLabel }, { headers });
      setFreshKey(r.data.key);
      void refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Création impossible.');
    }
  };

  const revokeKey = async (id: string): Promise<void> => {
    await axios.delete(`${API}/dev/keys/${id}`, { headers }).catch(() => undefined);
    toast.success('Clé révoquée.');
    void refresh();
  };

  const importCsv = async (file: File): Promise<void> => {
    const text = await file.text();
    const traffic: Record<string, Record<string, number>> = {};
    text.split(/\r?\n/).forEach((line) => {
      const [day, matin, apresMidi, soir] = line.split(/[;,\t]/).map((s) => s?.trim().toLowerCase() ?? '');
      const key = DAY_MAP[day];
      if (!key) return;
      traffic[key] = { matin: Number(matin) || 0, apres_midi: Number(apresMidi) || 0, soir: Number(soir) || 0 };
    });
    if (Object.keys(traffic).length === 0) {
      toast.error('CSV non reconnu. Format attendu : jour;matin;après-midi;soir (ex. lundi;40;65;30).');
      return;
    }
    try {
      const cur = await axios.get<{ weekly_budget: number; traffic: Record<string, Record<string, number>> }>(`${API}/schedule/settings`, { headers });
      await axios.put(`${API}/schedule/settings`, {
        weekly_budget: cur.data.weekly_budget ?? 0,
        traffic: { ...(cur.data.traffic ?? {}), ...traffic },
      }, { headers });
      toast.success(`Achalandage importé pour ${Object.keys(traffic).length} jour(s) — utilisé par les alertes de sous-effectif.`);
    } catch {
      toast.error('Import impossible.');
    }
  };

  const sorted = [...catalog].sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)));
  const webhookUrl = `${process.env.REACT_APP_BACKEND_URL}/api/integrations/pos/traffic`;

  return (
    <div data-testid="reports-module">
      <ModuleHeader title="Rapports & API" subtitle="Rapports favoris, envois programmés par courriel et intégrations POS." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6" data-testid="reports-catalog">
        {sorted.map((r) => (
          <div key={r.id} data-testid={`report-card-${r.id}`} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-heading font-bold text-slate-900 text-sm">{r.title}</p>
                <p className="text-xs text-slate-500 mt-1">{r.desc}</p>
              </div>
              <button
                data-testid={`report-fav-${r.id}`}
                onClick={() => void toggleFav(r.id)}
                title={favorites.includes(r.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                className="shrink-0"
              >
                <Star className={`w-5 h-5 transition-colors ${favorites.includes(r.id) ? 'fill-amber-400 text-amber-400' : 'text-slate-300 hover:text-amber-400'}`} />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <Select value={schedules[r.id] ?? 'off'} onValueChange={(v) => void setSchedule(r.id, v)}>
                <SelectTrigger data-testid={`report-schedule-${r.id}`} className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(FREQ_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button data-testid={`report-send-${r.id}`} size="sm" variant="outline" disabled={sending === r.id} onClick={() => void sendNow(r.id)} className="rounded-full text-xs h-8">
                <Send className="w-3.5 h-3.5 mr-1" /> {sending === r.id ? 'Envoi…' : "M'envoyer maintenant"}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <CollapsibleSection id="reports-api" title="API développeurs & intégration POS" icon={Plug} badge={keys.length > 0 ? `${keys.length} clé(s)` : undefined} className="mb-4">
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
          <div>
            <p className="text-sm font-bold text-slate-900 inline-flex items-center gap-2"><KeyRound className="w-4 h-4 text-bronze-600" /> Clés API</p>
            <p className="text-xs text-slate-500 mt-1">Permettent à votre système de caisse (POS) ou tout autre logiciel d'envoyer des données à Arrière Plan.</p>
            <div className="flex gap-2 mt-3">
              <Input data-testid="api-key-label-input" value={newKeyLabel} onChange={(e) => setNewKeyLabel(e.target.value)} placeholder="Nom de la clé" className="max-w-xs h-9" />
              <Button data-testid="api-key-create-button" size="sm" onClick={() => void createKey()} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs">
                Générer une clé
              </Button>
            </div>
            {freshKey && (
              <div data-testid="fresh-api-key" className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
                <code className="text-xs text-emerald-900 break-all flex-1">{freshKey}</code>
                <button data-testid="copy-api-key-button" onClick={() => { void navigator.clipboard.writeText(freshKey); toast.success('Clé copiée.'); }} className="text-emerald-700 hover:text-emerald-900 shrink-0">
                  <Copy className="w-4 h-4" />
                </button>
                <p className="w-full text-[10px] text-emerald-700 font-semibold">Copiez cette clé maintenant — elle ne sera plus jamais affichée.</p>
              </div>
            )}
            {keys.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {keys.map((k) => (
                  <div key={k.id} data-testid={`api-key-row-${k.id}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                    <p className="text-xs font-semibold text-slate-700">{k.label}</p>
                    <code className="text-[11px] text-slate-400">{k.prefix}…</code>
                    <p className="ml-auto text-[10px] text-slate-400">{k.last_used_at ? `Utilisée le ${k.last_used_at.slice(0, 10)}` : 'Jamais utilisée'}</p>
                    <button data-testid={`api-key-revoke-${k.id}`} onClick={() => void revokeKey(k.id)} className="text-slate-300 hover:text-red-600">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 pt-4">
            <p className="text-sm font-bold text-slate-900">Webhook achalandage POS</p>
            <p className="text-xs text-slate-500 mt-1">Votre POS peut pousser l'achalandage (clients par période) — il alimente les alertes de sous-effectif et l'IA d'horaires.</p>
            <pre data-testid="pos-doc-curl" className="mt-2 rounded-lg bg-slate-900 text-emerald-300 text-[11px] p-3 overflow-x-auto">
{`curl -X POST ${webhookUrl} \\
  -H "X-API-Key: VOTRE_CLE" -H "Content-Type: application/json" \\
  -d '{"traffic": {"mon": {"matin": 40, "apres_midi": 65, "soir": 30}}}'`}
            </pre>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <p className="text-sm font-bold text-slate-900">Import CSV de l'achalandage</p>
            <p className="text-xs text-slate-500 mt-1">Exportez depuis votre POS un CSV « jour;matin;après-midi;soir » (ex. <code>lundi;40;65;30</code>) puis importez-le ici.</p>
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" data-testid="pos-csv-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = ''; }} />
            <Button data-testid="pos-csv-button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} className="rounded-full text-xs mt-2">
              <Upload className="w-3.5 h-3.5 mr-1" /> Importer un CSV
            </Button>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}
