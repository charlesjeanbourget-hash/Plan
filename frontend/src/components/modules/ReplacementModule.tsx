import { useState, FormEvent } from 'react';
import { useHR } from '@/context/HRContext';
import { Position, POSITIONS } from '@/types';
import { ModuleHeader, StatusBadge, EmptyState } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, CalendarDays, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function ReplacementModule(): JSX.Element {
  const { state, addReplacementRequest, setReplacementStatus } = useHR();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [position, setPosition] = useState<Position>('Pharmacien(ne)');
  const [reason, setReason] = useState('');

  const handleAdd = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    addReplacementRequest({ date, startTime, endTime, position, reason, status: 'Ouverte' });
    toast.success('Demande publiée. Les agences partenaires seront notifiées.');
    setDialogOpen(false);
    setReason('');
  };

  return (
    <div data-testid="replacements-module">
      <ModuleHeader
        title="Remplacements"
        subtitle="Publiez vos besoins de remplacement auprès des agences partenaires."
        action={
          <Button data-testid="add-replacement-button" onClick={() => setDialogOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-1" /> Nouvelle demande
          </Button>
        }
      />
      {state.replacementRequests.length === 0 ? (
        <EmptyState text="Aucune demande de remplacement." />
      ) : (
        <div className="space-y-4">
          {state.replacementRequests.map((r) => (
            <div key={r.id} data-testid={`replacement-card-${r.id}`} className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-heading font-bold text-slate-900">{r.position}</h3>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                    <span className="inline-flex items-center gap-1.5"><CalendarDays className="w-4 h-4" /> {r.date}</span>
                    <span className="inline-flex items-center gap-1.5"><Clock className="w-4 h-4" /> {r.startTime} – {r.endTime}</span>
                  </div>
                  <p className="text-sm text-slate-600 mt-2">{r.reason}</p>
                  {r.agencyProposal && (
                    <p className="mt-3 text-sm text-sky-800 bg-sky-50 border border-sky-200 rounded-lg p-3">
                      Proposition d'agence : {r.agencyProposal}
                    </p>
                  )}
                </div>
                {(r.status === 'Ouverte' || r.status === 'Proposée') && (
                  <div className="flex gap-2 shrink-0">
                    {r.status === 'Proposée' && (
                      <Button
                        data-testid={`accept-replacement-${r.id}`}
                        onClick={() => { setReplacementStatus(r.id, 'Comblée'); toast.success('Remplacement confirmé !'); }}
                        className="rounded-full bg-emerald-600 hover:bg-emerald-700"
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1" /> Accepter
                      </Button>
                    )}
                    <Button
                      data-testid={`cancel-replacement-${r.id}`}
                      variant="outline"
                      onClick={() => { setReplacementStatus(r.id, 'Annulée'); toast.success('Demande annulée.'); }}
                      className="rounded-full text-red-600 border-red-200 hover:bg-red-50"
                    >
                      <XCircle className="w-4 h-4 mr-1" /> Annuler
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="add-replacement-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvelle demande de remplacement</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-2">
              <Label>Poste à combler</Label>
              <Select value={position} onValueChange={(v) => setPosition(v as Position)}>
                <SelectTrigger data-testid="replacement-position-select"><SelectValue /></SelectTrigger>
                <SelectContent>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input data-testid="replacement-date-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Début</Label>
                <Input data-testid="replacement-start-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Fin</Label>
                <Input data-testid="replacement-end-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Raison</Label>
              <Input data-testid="replacement-reason-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. : absence maladie" required />
            </div>
            <Button data-testid="replacement-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Publier la demande
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
