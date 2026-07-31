import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarCheck, RefreshCw, Trash2, Mail, Phone } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface DemoRequest {
  id: string;
  name: string;
  pharmacy: string;
  email: string;
  phone: string;
  message: string;
  status: string;
  created_at: string;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  nouvelle: { label: 'Nouvelle', cls: 'bg-bronze-100 text-bronze-800 border-bronze-300' },
  contactee: { label: 'Contactée', cls: 'bg-sky-100 text-sky-800 border-sky-300' },
  planifiee: { label: 'Planifiée', cls: 'bg-violet-100 text-violet-800 border-violet-300' },
  convertie: { label: 'Convertie', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
};

const fmtDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

export const SuperadminDemoRequests = (): JSX.Element => {
  const { token } = useAuth();
  const [requests, setRequests] = useState<DemoRequest[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await axios.get<DemoRequest[]>(`${API}/demo-requests`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setRequests(res.data);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const setStatus = async (r: DemoRequest, status: string): Promise<void> => {
    try {
      await axios.put(`${API}/demo-requests/${r.id}/status`, { status }, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setRequests((prev) => prev.map((x) => (x.id === r.id ? { ...x, status } : x)));
      toast.success(`Demande de ${r.name} : ${STATUS_META[status]?.label ?? status}.`);
    } catch {
      toast.error('Mise à jour impossible.');
    }
  };

  const remove = async (r: DemoRequest): Promise<void> => {
    try {
      await axios.delete(`${API}/demo-requests/${r.id}`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setRequests((prev) => prev.filter((x) => x.id !== r.id));
      toast.success('Demande supprimée.');
    } catch {
      toast.error('Suppression impossible.');
    }
  };

  const counts = requests.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-7 mb-10" data-testid="demo-requests-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-emerald-600" /> Demandes de démo
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Reçues via le formulaire de la page d'accueil.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {Object.entries(STATUS_META).map(([key, meta]) => (
            <span key={key} className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.cls}`}>
              {meta.label} : {counts[key] ?? 0}
            </span>
          ))}
          <Button
            data-testid="demo-requests-refresh"
            size="sm" variant="outline" className="rounded-full text-xs"
            onClick={() => void refresh()} disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> Actualiser
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        {requests.map((r) => (
          <div key={r.id} data-testid={`demo-request-row-${r.id}`} className="rounded-lg border border-slate-200 px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-slate-800">{r.name}</p>
                {r.pharmacy && <span className="text-xs text-slate-500">· {r.pharmacy}</span>}
                <span className="text-xs text-slate-400">· {fmtDate(r.created_at)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-slate-600">
                <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 hover:text-emerald-700">
                  <Mail className="w-3 h-3" /> {r.email}
                </a>
                {r.phone && (
                  <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-700">
                    <Phone className="w-3 h-3" /> {r.phone}
                  </a>
                )}
              </div>
              {r.message && <p className="text-xs text-slate-500 mt-1.5 italic">« {r.message} »</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Select value={r.status} onValueChange={(v) => void setStatus(r, v)}>
                <SelectTrigger data-testid={`demo-status-select-${r.id}`} className={`w-[130px] h-8 text-xs font-semibold rounded-full border ${STATUS_META[r.status]?.cls ?? ''}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_META).map(([key, meta]) => (
                    <SelectItem key={key} value={key}>{meta.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                data-testid={`demo-delete-${r.id}`}
                size="sm" variant="outline"
                className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50 h-8 w-8 p-0"
                onClick={() => void remove(r)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ))}
        {requests.length === 0 && !loading && (
          <p className="text-sm text-slate-500" data-testid="demo-requests-empty">
            Aucune demande de démo pour l'instant. Elles apparaîtront ici dès qu'un visiteur remplira le formulaire.
          </p>
        )}
      </div>
    </div>
  );
};
