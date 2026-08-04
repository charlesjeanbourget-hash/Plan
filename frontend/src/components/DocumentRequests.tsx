import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileQuestion } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export interface DocRequest {
  id: string;
  employee_name: string;
  doc_type: string;
  note: string;
  status: string;
  reply_note: string;
  created_at: string;
}

const DOC_TYPES = ["Attestation d'emploi", "Relevé d'emploi", 'Confirmation de salaire', 'Copie de contrat', 'Relevé fiscal', 'Autre'];
const STATUS_LABELS: Record<string, string> = { en_attente: 'En attente', en_traitement: 'En traitement', fournie: 'Fournie', refusee: 'Refusée' };
const STATUS_STYLE: Record<string, string> = {
  en_attente: 'bg-amber-100 text-amber-800', en_traitement: 'bg-sky-100 text-sky-700',
  fournie: 'bg-emerald-100 text-emerald-700', refusee: 'bg-red-100 text-red-700',
};

export const useDocRequests = (): { requests: DocRequest[]; refresh: () => Promise<void> } => {
  const { token } = useAuth();
  const [requests, setRequests] = useState<DocRequest[]>([]);
  const refresh = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      const r = await axios.get<DocRequest[]>(`${API}/document-requests`, { headers: { Authorization: `Bearer ${token}` } });
      setRequests(r.data);
    } catch { /* hors ligne */ }
  }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { requests, refresh };
};

export const MyDocRequests = (): JSX.Element => {
  const { token } = useAuth();
  const { requests, refresh } = useDocRequests();
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [note, setNote] = useState('');

  const submit = async (): Promise<void> => {
    try {
      await axios.post(`${API}/document-requests`, { doc_type: docType, note }, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      toast.success('Demande envoyée — vos gestionnaires sont notifiés.');
      setNote('');
      void refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Envoi impossible.');
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6" data-testid="my-doc-requests">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <div className="space-y-1.5">
          <Label>Document souhaité</Label>
          <Select value={docType} onValueChange={setDocType}>
            <SelectTrigger data-testid="doc-type-select"><SelectValue /></SelectTrigger>
            <SelectContent>{DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Précision (facultatif)</Label>
          <Input data-testid="doc-note-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pour ma banque, avant le 15…" />
        </div>
        <Button data-testid="doc-request-submit" onClick={() => void submit()} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
          Demander
        </Button>
      </div>
      {requests.length > 0 && (
        <div className="mt-4 space-y-2">
          {requests.map((r) => (
            <div key={r.id} data-testid={`my-doc-request-${r.id}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
              <FileQuestion className="w-3.5 h-3.5 text-slate-400" />
              <p className="text-sm text-slate-700 font-semibold">{r.doc_type}</p>
              {r.note && <p className="text-xs text-slate-400 truncate">· {r.note}</p>}
              <span className={`ml-auto rounded-full text-[10px] font-bold px-2 py-0.5 ${STATUS_STYLE[r.status]}`}>{STATUS_LABELS[r.status]}</span>
              {r.reply_note && <p className="w-full text-xs text-slate-500 pl-6">Réponse : {r.reply_note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const AdminDocRequests = (): JSX.Element => {
  const { token } = useAuth();
  const { requests, refresh } = useDocRequests();
  const [replies, setReplies] = useState<Record<string, string>>({});

  const patch = async (id: string, status: string): Promise<void> => {
    try {
      await axios.patch(`${API}/document-requests/${id}`, { status, reply_note: replies[id] ?? '' }, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      toast.success('Demande mise à jour — l\'employé est notifié.');
      void refresh();
    } catch {
      toast.error('Mise à jour impossible.');
    }
  };

  if (requests.length === 0) {
    return <p className="text-sm text-slate-500 bg-white rounded-xl border border-slate-200 p-5" data-testid="admin-doc-requests-empty">Aucune demande de document.</p>;
  }
  return (
    <div className="space-y-3" data-testid="admin-doc-requests">
      {requests.map((r) => (
        <div key={r.id} data-testid={`admin-doc-request-${r.id}`} className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-800">{r.employee_name}</p>
            <p className="text-sm text-slate-500">· {r.doc_type}</p>
            <span className={`ml-auto rounded-full text-[10px] font-bold px-2 py-0.5 ${STATUS_STYLE[r.status]}`}>{STATUS_LABELS[r.status]}</span>
          </div>
          {r.note && <p className="text-xs text-slate-500 mt-1">Note : {r.note}</p>}
          {(r.status === 'en_attente' || r.status === 'en_traitement') && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                data-testid={`doc-reply-input-${r.id}`}
                value={replies[r.id] ?? ''}
                onChange={(e) => setReplies({ ...replies, [r.id]: e.target.value })}
                placeholder="Note pour l'employé (facultatif)"
                className="flex-1 min-w-[200px] h-8 text-xs"
              />
              {r.status === 'en_attente' && (
                <Button data-testid={`doc-processing-${r.id}`} size="sm" variant="outline" className="rounded-full text-xs h-8" onClick={() => void patch(r.id, 'en_traitement')}>
                  En traitement
                </Button>
              )}
              <Button data-testid={`doc-fulfill-${r.id}`} size="sm" className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs h-8" onClick={() => void patch(r.id, 'fournie')}>
                Fournie
              </Button>
              <Button data-testid={`doc-refuse-${r.id}`} size="sm" variant="outline" className="rounded-full text-xs h-8 text-red-600" onClick={() => void patch(r.id, 'refusee')}>
                Refuser
              </Button>
            </div>
          )}
          {r.reply_note && r.status !== 'en_attente' && r.status !== 'en_traitement' && (
            <p className="text-xs text-slate-500 mt-1.5">Réponse : {r.reply_note}</p>
          )}
        </div>
      ))}
    </div>
  );
};
