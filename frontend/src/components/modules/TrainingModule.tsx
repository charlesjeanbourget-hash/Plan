import { useState, useEffect, useCallback, FormEvent, MouseEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Training } from '@/types';
import { ModuleHeader, EmptyState } from '@/components/modules/shared';
import TrainingEditor from '@/components/modules/TrainingEditor';
import TrainingViewer from '@/components/modules/TrainingViewer';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { GraduationCap, Plus, Loader2, Trash2, FileUp, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS_META: Record<Training['status'], { label: string; cls: string }> = {
  processing: { label: 'Préparation par l\'IA…', cls: 'bg-sky-100 text-sky-800' },
  draft: { label: 'Brouillon — à réviser', cls: 'bg-amber-100 text-amber-800' },
  published: { label: 'Publiée', cls: 'bg-emerald-100 text-emerald-800' },
  error: { label: 'Erreur de génération', cls: 'bg-red-100 text-red-800' },
};

const apiError = (err: unknown): string => {
  if (axios.isAxiosError(err) && err.response) {
    const detail = (err.response.data as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
  }
  return 'Une erreur est survenue.';
};

export default function TrainingModule(): JSX.Element {
  const { currentUser, token } = useAuth();
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Training | null>(null);
  const isEmployee = currentUser?.role === 'employee';

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<Training[]>(`${API}/trainings`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setTrainings(res.data);
    } catch {
      toast.error('Impossible de charger les formations.');
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!trainings.some((t) => t.status === 'processing')) return undefined;
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, [trainings, refresh]);

  const selected = trainings.find((t) => t.id === selectedId) ?? null;
  if (selected && isEmployee) {
    return <TrainingViewer training={selected} onBack={() => { setSelectedId(null); void refresh(); }} />;
  }
  if (selected && !isEmployee) {
    return <TrainingEditor training={selected} onUpdated={refresh} onBack={() => { setSelectedId(null); void refresh(); }} />;
  }

  const submitUpload = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.append('title', title);
    form.append('file', file);
    setProgress(0);
    try {
      await axios.post(`${API}/trainings/upload`, form, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
        onUploadProgress: (ev) => setProgress(ev.total ? Math.round((ev.loaded / ev.total) * 100) : 50),
      });
      toast.success('Document reçu ! L\'IA prépare la formation par secteur…');
      setUploadOpen(false);
      setTitle('');
      setFile(null);
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setProgress(null);
    }
  };

  const handleOpen = (t: Training): void => {
    if (t.status === 'processing') {
      toast.info('L\'IA prépare encore cette formation, un instant…');
      return;
    }
    setSelectedId(t.id);
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await axios.delete(`${API}/trainings/${deleteTarget.id}`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      toast.success('Formation supprimée.');
      setDeleteTarget(null);
      await refresh();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const askDelete = (e: MouseEvent, t: Training): void => {
    e.stopPropagation();
    setDeleteTarget(t);
  };

  return (
    <div data-testid="training-module">
      <ModuleHeader
        title="Formations"
        subtitle={isEmployee
          ? 'Complétez vos formations par secteur et réussissez l\'examen final.'
          : 'Déposez un dossier de formation en PDF — l\'IA le découpe par secteur et génère l\'examen final.'}
        action={!isEmployee ? (
          <Button data-testid="upload-training-button" onClick={() => setUploadOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-1" /> Nouvelle formation (PDF)
          </Button>
        ) : undefined}
      />

      {trainings.length === 0 && (
        <EmptyState text={isEmployee
          ? 'Aucune formation publiée pour le moment.'
          : 'Aucune formation. Déposez un PDF pour que l\'IA prépare le parcours et l\'examen.'} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {trainings.map((t) => {
          const meta = STATUS_META[t.status];
          return (
            <button
              key={t.id}
              data-testid={`training-card-${t.id}`}
              onClick={() => handleOpen(t)}
              className="text-left bg-white rounded-xl border border-slate-200 p-6 hover:border-emerald-300 hover:-translate-y-0.5 transition-all"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                  {t.status === 'processing'
                    ? <Loader2 className="w-4 h-4 text-sky-600 animate-spin" />
                    : t.status === 'error'
                      ? <AlertTriangle className="w-4 h-4 text-red-600" />
                      : <GraduationCap className="w-4 h-4 text-emerald-600" />}
                </span>
                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>
                  {isEmployee && t.my_passed ? 'Réussie' : meta.label}
                </span>
              </div>
              <p className="font-heading font-bold text-slate-900 mb-1">{t.title}</p>
              <p className="text-xs text-slate-500 mb-3">
                {t.sections.length} section(s) · {t.exam.length} question(s) · {t.created_at.slice(0, 10)}
              </p>
              {t.status === 'error' && !isEmployee && (
                <p className="text-xs text-red-600 mb-2">{t.error ?? 'La génération a échoué. Supprimez et réessayez.'}</p>
              )}
              {isEmployee && t.my_assignment && !t.my_passed && (
                <p className={`text-xs font-semibold rounded-full px-2.5 py-0.5 inline-flex mb-2 ${
                  t.my_assignment.due_date < new Date().toISOString().slice(0, 10)
                    ? 'bg-red-100 text-red-800'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  À compléter avant le {t.my_assignment.due_date}
                </p>
              )}
              {isEmployee ? (
                <p className="text-xs text-slate-500 inline-flex items-center gap-1.5">
                  {t.my_passed
                    ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Examen réussi — {t.my_best_score} %</>
                    : (t.my_attempts ?? 0) > 0
                      ? <>Meilleur résultat : {t.my_best_score} % — note de passage {t.passing_score} %</>
                      : <>Examen à compléter — note de passage {t.passing_score} %</>}
                </p>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-400 truncate">{t.source_filename}</p>
                  <span
                    role="button"
                    tabIndex={0}
                    data-testid={`delete-training-${t.id}`}
                    onClick={(e) => askDelete(e, t)}
                    onKeyDown={() => undefined}
                    className="p-1.5 rounded-full text-red-500 hover:bg-red-50 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <Dialog open={uploadOpen} onOpenChange={(o) => { if (progress === null) setUploadOpen(o); }}>
        <DialogContent data-testid="upload-training-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvelle formation par IA</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-500">
            Déposez votre dossier de formation en PDF (procédures, règlements, tâches…). L'IA préparera le contenu
            par secteur (ouverture, comptage des pilules, nettoyage, savoir-être…) et un examen final à choix multiples.
          </p>
          <form onSubmit={(e) => void submitUpload(e)} className="space-y-4">
            <div className="space-y-2">
              <Label>Titre de la formation</Label>
              <Input data-testid="training-title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Intégration des nouveaux employés" required />
            </div>
            <div className="space-y-2">
              <Label>Dossier de formation (PDF, max 15 Mo)</Label>
              <label
                data-testid="training-file-drop"
                className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-xl p-6 cursor-pointer hover:border-emerald-400 transition-colors"
              >
                <FileUp className="w-6 h-6 text-emerald-600" />
                <span className="text-sm text-slate-600">{file ? file.name : 'Cliquez pour choisir un PDF'}</span>
                <input
                  data-testid="training-file-input"
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            {progress !== null && (
              <div className="space-y-1">
                <Progress value={progress} />
                <p className="text-xs text-slate-500 text-center">{progress < 100 ? `Téléversement… ${progress} %` : 'Analyse du document…'}</p>
              </div>
            )}
            <Button data-testid="training-submit-button" type="submit" disabled={!file || progress !== null} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              {progress !== null ? 'Envoi en cours…' : 'Lancer la génération par IA'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent data-testid="delete-training-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading text-red-600">Supprimer la formation</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            Supprimer « <strong>{deleteTarget?.title}</strong> » ainsi que tous les résultats d'examen associés ?
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" className="rounded-full" onClick={() => setDeleteTarget(null)}>Annuler</Button>
            <Button data-testid="confirm-delete-training-button" onClick={() => void handleDelete()} className="rounded-full bg-red-600 hover:bg-red-700 text-white">
              Supprimer définitivement
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
