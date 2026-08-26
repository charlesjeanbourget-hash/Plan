import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { roleForPosition, ACCOUNT_ROLE_LABELS, AccountRole } from '@/lib/accountRole';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { UserPlus, Mail, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface InviteResult {
  employee_id: string;
  email: string;
  name?: string;
  role?: string;
  created: boolean;
  email_sent?: boolean;
  temporary_password?: string | null;
  reason?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export const StaffEnrollmentDialog = ({ open, onClose }: Props): JSX.Element => {
  const { state } = useHR();
  const { token } = useAuth();
  const [linkedIds, setLinkedIds] = useState<string[] | null>(null);
  const [roles, setRoles] = useState<Record<string, AccountRole>>({});
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const r = await axios.get<{ ids: string[] }>(`${API}/accounts/linked-employee-ids`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setLinkedIds(r.data.ids);
    } catch {
      setLinkedIds([]);
    }
  }, [token]);

  useEffect(() => {
    if (!open) return;
    setResults(null);
    setRoles({});
    setExcluded({});
    setLinkedIds(null);
    void load();
  }, [open, load]);

  const pending = state.employees.filter(
    (e) => !e.anonymized && e.email.trim() && linkedIds !== null && !linkedIds.includes(e.id)
  );
  const selectedPending = pending.filter((e) => !excluded[e.id]);

  const send = async (): Promise<void> => {
    setSending(true);
    try {
      const items = selectedPending.map((e) => ({
        employee_id: e.id,
        email: e.email.trim(),
        name: `${e.firstName} ${e.lastName}`,
        role: roles[e.id] ?? roleForPosition(e.position),
      }));
      const r = await axios.post<{ results: InviteResult[]; created: number }>(
        `${API}/accounts/bulk-invite`, { items }, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setResults(r.data.results);
      toast.success(`${r.data.created} compte(s) créé(s) — invitations envoyées par courriel.`);
      void load();
    } catch {
      toast.error("L'envoi des invitations a échoué. Réessayez.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-testid="staff-enrollment-dialog" className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading inline-flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-emerald-600" /> Compléter l&apos;inscription du personnel
          </DialogTitle>
          <DialogDescription>
            Crée un compte de connexion pour chaque employé ayant un courriel au dossier mais pas encore de compte.
            Chacun reçoit un courriel avec un mot de passe temporaire à changer à la première connexion.
          </DialogDescription>
        </DialogHeader>

        {results ? (
          <div className="space-y-2" data-testid="enrollment-results">
            {results.map((r) => (
              <div key={r.employee_id} className={`rounded-lg border px-4 py-2.5 text-sm ${r.created ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
                <p className="font-semibold text-slate-800 inline-flex items-center gap-2">
                  {r.created ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-amber-600" />}
                  {r.name || r.email}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  {r.created
                    ? r.email_sent
                      ? <>Compte {ACCOUNT_ROLE_LABELS[(r.role as AccountRole) ?? 'employee']} créé — invitation envoyée à {r.email}</>
                      : <>Compte créé mais le courriel a échoué — mot de passe temporaire : <span className="font-mono font-bold">{r.temporary_password}</span></>
                    : r.reason}
                </p>
              </div>
            ))}
            <Button data-testid="enrollment-close" onClick={onClose} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">Fermer</Button>
          </div>
        ) : linkedIds === null ? (
          <p className="text-sm text-slate-400">Chargement…</p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-slate-500 bg-slate-50 rounded-lg border border-slate-200 p-4" data-testid="enrollment-empty">
            Tous les employés ayant un courriel au dossier ont déjà un compte de connexion.
            Pour les autres, ajoutez d&apos;abord leur courriel dans leur fiche.
          </p>
        ) : (
          <>
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
              {pending.map((e) => (
                <div key={e.id} data-testid={`enrollment-row-${e.id}`} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${excluded[e.id] ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <Checkbox
                      data-testid={`enrollment-check-${e.id}`}
                      checked={!excluded[e.id]}
                      onCheckedChange={(v) => setExcluded((prev) => ({ ...prev, [e.id]: v !== true }))}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800">{e.firstName} {e.lastName}</p>
                      <p className="text-xs text-slate-500 truncate inline-flex items-center gap-1"><Mail className="w-3 h-3" /> {e.email} · {e.position}</p>
                    </div>
                  </div>
                  <Select
                    value={roles[e.id] ?? roleForPosition(e.position)}
                    onValueChange={(v) => setRoles((prev) => ({ ...prev, [e.id]: v as AccountRole }))}
                  >
                    <SelectTrigger data-testid={`enrollment-role-${e.id}`} className="w-40 h-8 text-xs shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">Employé</SelectItem>
                      <SelectItem value="manager">Gestionnaire</SelectItem>
                      <SelectItem value="admin">Administrateur</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <Button
              data-testid="enrollment-send"
              disabled={sending || selectedPending.length === 0}
              onClick={() => void send()}
              className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700"
            >
              {sending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Envoi…</> : `Créer ${selectedPending.length} compte(s) et envoyer les invitations`}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
