import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { ModuleHeader } from '@/components/modules/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HeartHandshake, Plus, FileUp, Pencil, Trash2, Eye, EyeOff, ImagePlus, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { POSITIONS } from '@/types';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const CATEGORIES = ['Santé', 'Dentaire', 'Vision', 'Retraite & épargne', 'Congés & vacances', 'Rabais employés', 'Formation & développement', 'Bien-être', 'Assurances', 'Autre'];

interface Benefit {
  id: string;
  title: string;
  description: string;
  category: string;
  details: string[];
  eligible_roles: string[];
  monthly_value: string;
  status: string;
  source: string;
  image_status: string;
}

interface BenefitForm {
  title: string;
  description: string;
  category: string;
  details: string;
  eligible_roles: string[];
  monthly_value: string;
}

const emptyForm: BenefitForm = { title: '', description: '', category: 'Santé', details: '', eligible_roles: [], monthly_value: '' };

const BenefitImage = ({ id, imageStatus, token }: { id: string; imageStatus: string; token: string | null }): JSX.Element => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked: string | null = null;
    if (imageStatus === 'done' && token) {
      axios.get(`${API}/benefits/${id}/image`, { headers: { Authorization: `Bearer ${token}` }, responseType: 'blob' })
        .then((res) => { revoked = URL.createObjectURL(res.data as Blob); setUrl(revoked); })
        .catch(() => setUrl(null));
    }
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [id, imageStatus, token]);
  if (url) return <img src={url} alt="" className="w-full h-40 object-cover" data-testid={`benefit-image-${id}`} />;
  return (
    <div className="w-full h-40 bg-gradient-to-br from-emerald-50 via-white to-bronze-50 flex flex-col items-center justify-center gap-2" data-testid={`benefit-image-placeholder-${id}`}>
      {imageStatus === 'pending' ? (
        <>
          <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
          <p className="text-[11px] text-slate-500 font-medium">Illustration en création par l'IA…</p>
        </>
      ) : (
        <HeartHandshake className="w-9 h-9 text-emerald-300" />
      )}
    </div>
  );
};

export default function BenefitsModule(): JSX.Element {
  const { state } = useHR();
  const { currentUser, token } = useAuth();
  const isAdmin = currentUser?.role !== 'employee';
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const myPosition = state.employees.find((e) => e.id === currentUser?.employeeId)?.position ?? '';

  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BenefitForm>(emptyForm);
  const [importJob, setImportJob] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      const res = await axios.get<Benefit[]>(`${API}/benefits`, { headers: { Authorization: `Bearer ${token}` } });
      setBenefits(res.data);
    } catch {
      /* hors ligne */
    }
    setLoaded(true);
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const hasPendingImages = benefits.some((b) => b.image_status === 'pending');
  useEffect(() => {
    if (!hasPendingImages) return;
    const id = setInterval(() => void refresh(), 8000);
    return () => clearInterval(id);
  }, [hasPendingImages, refresh]);

  useEffect(() => {
    if (!importJob) return;
    const id = setInterval(() => {
      axios.get<{ status: string; created_count: number; error?: string }>(`${API}/benefits/imports/${importJob}`, { headers: { Authorization: `Bearer ${token ?? ''}` } })
        .then((res) => {
          if (res.data.status === 'done') {
            toast.success(`${res.data.created_count} avantage(s) créés par l'IA. Révisez-les puis publiez.`);
            setImportJob(null);
            void refresh();
          } else if (res.data.status === 'error') {
            toast.error(res.data.error ?? "L'analyse du PDF a échoué.");
            setImportJob(null);
          }
        })
        .catch(() => setImportJob(null));
    }, 3000);
    return () => clearInterval(id);
  }, [importJob, token, refresh]);

  const uploadPdf = async (file: File): Promise<void> => {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await axios.post<{ job_id: string }>(`${API}/benefits/upload`, fd, { headers });
      setImportJob(res.data.job_id);
      toast.success("Document reçu — l'IA analyse vos avantages…");
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Téléversement impossible.');
    }
  };

  const openEditor = (b: Benefit | null): void => {
    setEditingId(b?.id ?? null);
    setForm(b ? {
      title: b.title, description: b.description, category: b.category,
      details: b.details.join('\n'), eligible_roles: b.eligible_roles, monthly_value: b.monthly_value,
    } : emptyForm);
    setEditorOpen(true);
  };

  const saveBenefit = async (): Promise<void> => {
    const payload = {
      title: form.title, description: form.description, category: form.category,
      details: form.details.split('\n').map((l) => l.trim()).filter(Boolean),
      eligible_roles: form.eligible_roles, monthly_value: form.monthly_value,
    };
    try {
      if (editingId) {
        await axios.put(`${API}/benefits/${editingId}`, payload, { headers });
        toast.success('Avantage mis à jour.');
      } else {
        await axios.post(`${API}/benefits`, payload, { headers });
        toast.success("Avantage créé — l'illustration arrive dans un instant.");
      }
      setEditorOpen(false);
      void refresh();
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Enregistrement impossible.');
    }
  };

  const togglePublish = async (b: Benefit): Promise<void> => {
    try {
      await axios.put(`${API}/benefits/${b.id}`, { status: b.status === 'published' ? 'draft' : 'published' }, { headers });
      toast.success(b.status === 'published' ? 'Avantage retiré de la vue des employés.' : 'Avantage publié — visible par les employés admissibles.');
      void refresh();
    } catch {
      toast.error('Action impossible.');
    }
  };

  const removeBenefit = async (id: string): Promise<void> => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      toast.warning('Cliquez de nouveau pour confirmer la suppression.');
      return;
    }
    setConfirmDelete(null);
    try {
      await axios.delete(`${API}/benefits/${id}`, { headers });
      toast.success('Avantage supprimé.');
      void refresh();
    } catch {
      toast.error('Suppression impossible.');
    }
  };

  const regenImage = async (id: string): Promise<void> => {
    try {
      await axios.post(`${API}/benefits/${id}/generate-image`, {}, { headers });
      toast.success('Nouvelle illustration en cours de création…');
      void refresh();
    } catch {
      toast.error('Génération impossible.');
    }
  };

  const toggleRole = (r: string): void => {
    setForm((f) => ({ ...f, eligible_roles: f.eligible_roles.includes(r) ? f.eligible_roles.filter((x) => x !== r) : [...f.eligible_roles, r] }));
  };

  const visible = isAdmin
    ? benefits
    : benefits.filter((b) => b.eligible_roles.length === 0 || b.eligible_roles.includes(myPosition));
  const categories = CATEGORIES.filter((c) => visible.some((b) => b.category === c));

  return (
    <div data-testid="benefits-module">
      <ModuleHeader
        title="Avantages sociaux"
        subtitle={isAdmin ? 'Créez vos avantages à la main ou importez le document PDF de votre compagnie — l\'IA fait le reste.' : 'Les programmes offerts par votre employeur, selon votre poste.'}
        action={isAdmin ? (
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept=".pdf" className="hidden" data-testid="benefits-pdf-input"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadPdf(f); e.target.value = ''; }} />
            <Button data-testid="benefits-upload-button" variant="outline" disabled={!!importJob} onClick={() => fileRef.current?.click()} className="rounded-full border-bronze-300 text-bronze-800 hover:bg-bronze-50">
              {importJob ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileUp className="w-4 h-4 mr-1" />}
              {importJob ? 'Analyse IA en cours…' : 'Importer un PDF'}
            </Button>
            <Button data-testid="benefit-add-button" onClick={() => openEditor(null)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-4 h-4 mr-1" /> Nouvel avantage
            </Button>
          </div>
        ) : undefined}
      />

      {importJob && (
        <div data-testid="benefits-import-status" className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3">
          <Sparkles className="w-4 h-4 text-emerald-700 shrink-0" />
          <p className="text-sm text-emerald-800 font-medium">L'IA lit votre document et prépare des cartes d'avantages claires avec illustrations. Cela prend environ une minute.</p>
        </div>
      )}

      {loaded && visible.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-14 text-center" data-testid="benefits-empty-state">
          <HeartHandshake className="w-10 h-10 text-emerald-300 mx-auto mb-4" />
          <p className="font-heading font-bold text-slate-800">Aucun avantage {isAdmin ? 'pour le moment' : 'publié pour votre poste'}</p>
          {isAdmin && <p className="text-sm text-slate-500 mt-1.5">Importez le PDF de votre compagnie ou créez un premier avantage à la main.</p>}
        </div>
      )}

      {categories.map((cat) => (
        <div key={cat} className="mb-10" data-testid={`benefit-category-${cat}`}>
          <h3 className="font-heading font-bold text-slate-900 text-lg mb-4">{cat}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {visible.filter((b) => b.category === cat).map((b) => (
              <div key={b.id} data-testid={`benefit-card-${b.id}`} className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow">
                <BenefitImage id={b.id} imageStatus={b.image_status} token={token} />
                <div className="p-6 flex flex-col flex-1">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h4 className="font-heading font-bold text-slate-900">{b.title}</h4>
                    {isAdmin && (
                      <span data-testid={`benefit-status-${b.id}`} className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${b.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {b.status === 'published' ? 'Publié' : 'Brouillon'}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-600 mb-3">{b.description}</p>
                  {b.details.length > 0 && (
                    <ul className="space-y-1.5 mb-4">
                      {b.details.map((d, i) => (
                        <li key={i} className="text-xs text-slate-600 flex gap-2">
                          <span className="text-emerald-600 font-bold shrink-0">✓</span>{d}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-auto pt-4 border-t border-slate-100 space-y-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {b.monthly_value && <span className="px-2.5 py-1 rounded-full bg-bronze-50 text-bronze-800 text-[11px] font-semibold">{b.monthly_value}</span>}
                      {b.eligible_roles.length === 0 ? (
                        <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold">Tous les employés</span>
                      ) : (
                        b.eligible_roles.map((r) => (
                          <span key={r} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${r === myPosition ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{r}</span>
                        ))
                      )}
                    </div>
                    {isAdmin && (
                      <div className="flex flex-wrap gap-1.5">
                        <Button data-testid={`benefit-publish-${b.id}`} size="sm" variant="outline" onClick={() => void togglePublish(b)} className="rounded-full text-xs h-7">
                          {b.status === 'published' ? <><EyeOff className="w-3 h-3 mr-1" /> Dépublier</> : <><Eye className="w-3 h-3 mr-1" /> Publier</>}
                        </Button>
                        <Button data-testid={`benefit-edit-${b.id}`} size="sm" variant="outline" onClick={() => openEditor(b)} className="rounded-full text-xs h-7">
                          <Pencil className="w-3 h-3 mr-1" /> Modifier
                        </Button>
                        <Button data-testid={`benefit-regen-image-${b.id}`} size="sm" variant="outline" disabled={b.image_status === 'pending'} onClick={() => void regenImage(b.id)} className="rounded-full text-xs h-7">
                          <ImagePlus className="w-3 h-3 mr-1" /> Image
                        </Button>
                        <Button data-testid={`benefit-delete-${b.id}`} size="sm" variant="outline" onClick={() => void removeBenefit(b.id)} className={`rounded-full text-xs h-7 ${confirmDelete === b.id ? 'border-red-400 text-red-600 bg-red-50' : 'text-red-600'}`}>
                          <Trash2 className="w-3 h-3 mr-1" /> {confirmDelete === b.id ? 'Confirmer' : ''}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent data-testid="benefit-editor-dialog" className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">{editingId ? 'Modifier l\'avantage' : 'Nouvel avantage'}</DialogTitle>
            <DialogDescription>Une illustration est générée automatiquement par l'IA pour chaque avantage.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Titre</Label>
              <Input data-testid="benefit-title-input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Assurance dentaire familiale" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea data-testid="benefit-description-input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} placeholder="Expliquez l'avantage en 2-3 phrases simples." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Catégorie</Label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger data-testid="benefit-category-select"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Valeur (facultatif)</Label>
                <Input data-testid="benefit-value-input" value={form.monthly_value} onChange={(e) => setForm((f) => ({ ...f, monthly_value: e.target.value }))} placeholder="Employeur paie 50 %" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Points clés (un par ligne)</Label>
              <Textarea data-testid="benefit-details-input" value={form.details} onChange={(e) => setForm((f) => ({ ...f, details: e.target.value }))} rows={4} placeholder={'Couverture 80 % des soins\nAdmissible après 3 mois'} />
            </div>
            <div className="space-y-1.5">
              <Label>Postes admissibles (aucun coché = tous les employés)</Label>
              <div className="flex flex-wrap gap-2">
                {POSITIONS.map((r) => (
                  <label key={r} data-testid={`benefit-role-${r}`} className={`px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer border transition-colors ${form.eligible_roles.includes(r) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'}`}>
                    <input type="checkbox" className="hidden" checked={form.eligible_roles.includes(r)} onChange={() => toggleRole(r)} />
                    {r}
                  </label>
                ))}
              </div>
            </div>
            <Button data-testid="benefit-save-button" onClick={() => void saveBenefit()} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              {editingId ? 'Enregistrer les modifications' : 'Créer l\'avantage'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
