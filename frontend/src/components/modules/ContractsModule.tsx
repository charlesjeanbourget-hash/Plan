import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { ModuleHeader, EmptyState, CollapsibleSection } from '@/components/modules/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { FileText, CheckCircle2, AlertCircle, FileQuestion, PenLine } from 'lucide-react';
import { SignaturePad } from '@/components/SignaturePad';
import { AdminDocRequests, useDocRequests } from '@/components/DocumentRequests';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface ContractSignature {
  contract_id: string;
  signed_by: string;
  signed_at: string;
  signature: string;
}

export default function ContractsModule(): JSX.Element {
  const { state, updateContract, getEmployee } = useHR();
  const { token } = useAuth();
  const { requests } = useDocRequests();
  const [signatures, setSignatures] = useState<Record<string, ContractSignature>>({});
  const [signTarget, setSignTarget] = useState<{ id: string; label: string; employeeId: string } | null>(null);
  const [signSaving, setSignSaving] = useState(false);
  const [viewSig, setViewSig] = useState<ContractSignature | null>(null);

  const loadSignatures = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      const r = await axios.get<ContractSignature[]>(`${API}/contracts/signatures`, { headers: { Authorization: `Bearer ${token}` } });
      const m: Record<string, ContractSignature> = {};
      r.data.forEach((s) => { m[s.contract_id] = s; });
      setSignatures(m);
    } catch { /* hors ligne */ }
  }, [token]);

  useEffect(() => { void loadSignatures(); }, [loadSignatures]);

  const saveSignature = async (dataUrl: string): Promise<void> => {
    if (!signTarget) return;
    setSignSaving(true);
    try {
      await axios.post(`${API}/contracts/sign`, {
        contract_id: signTarget.id, contract_label: signTarget.label,
        signature: dataUrl, employee_id: signTarget.employeeId,
      }, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      updateContract(signTarget.id, { signed: true });
      toast.success('Contrat signé électroniquement.');
      setSignTarget(null);
      void loadSignatures();
    } catch {
      toast.error('Signature impossible.');
    } finally {
      setSignSaving(false);
    }
  };

  const pendingDocs = requests.filter((r) => r.status === 'en_attente' || r.status === 'en_traitement').length;

  return (
    <div data-testid="contracts-module">
      <ModuleHeader title="Contrats" subtitle="Contrats de travail, signatures électroniques et demandes de documents." />

      <CollapsibleSection
        id="contracts-doc-requests"
        title="Demandes de documents RH"
        icon={FileQuestion}
        badge={pendingDocs > 0 ? `${pendingDocs} à traiter` : undefined}
        badgeTone="amber"
        defaultOpen={pendingDocs > 0}
        className="mb-6"
      >
        <AdminDocRequests />
      </CollapsibleSection>

      {state.contracts.length === 0 ? (
        <EmptyState text="Aucun contrat enregistré." />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
                <th className="p-4">Employé</th>
                <th className="p-4">Type</th>
                <th className="p-4">Début</th>
                <th className="p-4">Fin</th>
                <th className="p-4">Salaire</th>
                <th className="p-4">Signature</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody>
              {state.contracts.map((c) => {
                const emp = getEmployee(c.employeeId);
                const sig = signatures[c.id];
                return (
                  <tr key={c.id} data-testid={`contract-row-${c.id}`} className="border-b border-slate-100 last:border-0">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <FileText className="w-4 h-4 text-slate-400" />
                        <div>
                          <p className="font-semibold text-slate-800">{emp ? `${emp.firstName} ${emp.lastName}` : 'Inconnu'}</p>
                          <p className="text-xs text-slate-500">{emp?.position}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-slate-600">{c.type}</td>
                    <td className="p-4 text-slate-600">{c.startDate}</td>
                    <td className="p-4 text-slate-600">{c.endDate ?? 'Indéterminée'}</td>
                    <td className="p-4 font-semibold text-slate-800">{c.salary}</td>
                    <td className="p-4">
                      {sig ? (
                        <button data-testid={`view-signature-${c.id}`} onClick={() => setViewSig(sig)} className="inline-flex items-center gap-1.5 text-emerald-700 text-xs font-semibold hover:underline">
                          <CheckCircle2 className="w-4 h-4" /> Signé électroniquement
                        </button>
                      ) : c.signed ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700 text-xs font-semibold">
                          <CheckCircle2 className="w-4 h-4" /> Signé
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-orange-600 text-xs font-semibold">
                          <AlertCircle className="w-4 h-4" /> En attente
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      {!c.signed && !sig && (
                        <div className="flex justify-end gap-2">
                          <Button
                            data-testid={`esign-contract-${c.id}`}
                            size="sm"
                            onClick={() => setSignTarget({ id: c.id, label: `${c.type} — ${emp ? `${emp.firstName} ${emp.lastName}` : ''}`, employeeId: c.employeeId })}
                            className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs"
                          >
                            <PenLine className="w-3.5 h-3.5 mr-1" /> Faire signer
                          </Button>
                          <Button
                            data-testid={`sign-contract-${c.id}`}
                            size="sm"
                            variant="outline"
                            onClick={() => { updateContract(c.id, { signed: true }); toast.success('Contrat marqué comme signé.'); }}
                            className="rounded-full text-xs"
                          >
                            Marquer signé
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!signTarget} onOpenChange={(v) => { if (!v) setSignTarget(null); }}>
        <DialogContent data-testid="esign-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading inline-flex items-center gap-2"><PenLine className="w-4 h-4 text-emerald-600" /> Signature électronique</DialogTitle>
            <DialogDescription>{signTarget?.label} — faites signer l'employé directement sur cet écran.</DialogDescription>
          </DialogHeader>
          <SignaturePad onSave={(d) => void saveSignature(d)} saving={signSaving} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewSig} onOpenChange={(v) => { if (!v) setViewSig(null); }}>
        <DialogContent data-testid="view-signature-dialog" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Signature enregistrée</DialogTitle>
            <DialogDescription>
              Signé par {viewSig?.signed_by} le {viewSig ? new Date(viewSig.signed_at).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}.
            </DialogDescription>
          </DialogHeader>
          {viewSig && <img src={viewSig.signature} alt="Signature" className="w-full rounded-xl border border-slate-200 bg-white" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
