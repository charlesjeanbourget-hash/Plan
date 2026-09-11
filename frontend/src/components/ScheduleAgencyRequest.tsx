import { FormEvent, useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { Agency, Position, POSITIONS, ReplacementSlotT } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Building2, Plus, Trash2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export function ScheduleAgencyRequest({ open, onOpenChange, defaultDate, defaultStart, defaultEnd }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  defaultDate?: string; defaultStart?: string; defaultEnd?: string;
}): JSX.Element {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const [role, setRole] = useState<Position>('Pharmacien(ne)');
  const [urgency, setUrgency] = useState('Normale');
  const [perdiem, setPerdiem] = useState('');
  const [rateHint, setRateHint] = useState('');
  const [notes, setNotes] = useState('');
  const [slots, setSlots] = useState<ReplacementSlotT[]>([
    { date: defaultDate || new Date().toISOString().slice(0, 10), start: defaultStart || '09:00', end: defaultEnd || '17:00' },
  ]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open || !token) return;
    axios.get<Agency[]>(`${API}/agencies`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setAgencies(r.data)).catch(() => setAgencies([]));
    setSlots([{ date: defaultDate || new Date().toISOString().slice(0, 10), start: defaultStart || '09:00', end: defaultEnd || '17:00' }]);
  }, [open, token, defaultDate, defaultStart, defaultEnd]);

  const matching = agencies.filter((a) => a.roles.includes(role)).length;

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setCreating(true);
    const extra = [notes, rateHint ? `Taux proposé : ${rateHint} $/h` : '', perdiem ? `Perdiem / indemnités : ${perdiem}` : ''].filter(Boolean).join('\n');
    try {
      const res = await axios.post<{ emails_sent: number }>(`${API}/replacements/requests`, {
        role, slots, notes: extra, urgency, public_base_url: window.location.origin,
      }, { headers });
      toast.success(`Demande envoyée à ${res.data.emails_sent} agence(s). Une offre acceptée entre dans l’horaire.`);
      onOpenChange(false);
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Envoi impossible.');
    } finally { setCreating(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="schedule-agency-dialog" className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2"><Building2 className="w-5 h-5 text-emerald-600" /> Demande aux agences</DialogTitle>
          <DialogDescription>Les agences reçoivent un courriel. Si le propriétaire accepte une offre, les plages apparaissent dans le calendrier.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Poste</Label>
              <select value={role} onChange={(e) => setRole(e.target.value as Position)} className="w-full h-10 rounded-md border px-3 text-sm" data-testid="agency-role">
                {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <Label>Urgence</Label>
              <select value={urgency} onChange={(e) => setUrgency(e.target.value)} className="w-full h-10 rounded-md border px-3 text-sm">
                {['Faible', 'Normale', 'Élevée', 'Urgente'].map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <p className={`text-xs rounded-lg p-2 ${matching > 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
            {matching > 0 ? `${matching} agence(s) seront contactées.` : 'Aucune agence pour ce poste — le lien public reste disponible.'}
          </p>
          <div>
            <Label>Plages</Label>
            {slots.map((s, i) => (
              <div key={i} className="flex gap-2 mt-1">
                <Input type="date" value={s.date} onChange={(e) => setSlots((p) => p.map((x, n) => n === i ? { ...x, date: e.target.value } : x))} />
                <Input type="time" value={s.start} onChange={(e) => setSlots((p) => p.map((x, n) => n === i ? { ...x, start: e.target.value } : x))} className="w-28" />
                <Input type="time" value={s.end} onChange={(e) => setSlots((p) => p.map((x, n) => n === i ? { ...x, end: e.target.value } : x))} className="w-28" />
                {slots.length > 1 && <button type="button" onClick={() => setSlots((p) => p.filter((_, n) => n !== i))} className="text-red-500"><Trash2 className="w-4 h-4" /></button>}
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" className="mt-2 rounded-full text-xs" onClick={() => setSlots((p) => [...p, { ...p[p.length - 1] }])}>
              <Plus className="w-3 h-3 mr-1" /> Plage
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Taux horaire max ($/h)</Label><Input value={rateHint} onChange={(e) => setRateHint(e.target.value)} placeholder="Ex. 65" /></div>
            <div><Label>Perdiem / indemnités</Label><Input value={perdiem} onChange={(e) => setPerdiem(e.target.value)} placeholder="Ex. 75 $ + km" /></div>
          </div>
          <div><Label>Précisions</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <Button type="submit" disabled={creating} className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700" data-testid="agency-submit">
            {creating ? 'Envoi…' : 'Envoyer aux agences'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
