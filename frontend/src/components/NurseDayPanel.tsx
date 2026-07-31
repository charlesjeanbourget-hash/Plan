import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { useHR } from '@/context/HRContext';
import { Appointment } from '@/types';
import { AppointmentDialog } from '@/components/AppointmentDialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Stethoscope, Clock, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const isoLocal = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const NurseDayPanel = (): JSX.Element | null => {
  const { token, currentUser } = useAuth();
  const { state } = useHR();
  const me = state.employees.find((e) => e.id === currentUser?.employeeId);
  const [offset, setOffset] = useState(0);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [apptOpen, setApptOpen] = useState(false);

  const dayDate = new Date();
  dayDate.setDate(dayDate.getDate() + offset);
  const day = isoLocal(dayDate);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<Appointment[]>(`${API}/appointments?start=${day}&end=${day}`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setAppointments(res.data.filter((a) => a.employee_id === currentUser?.employeeId));
    } catch {
      setAppointments([]);
    }
  }, [token, day, currentUser?.employeeId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!me || me.position !== 'Infirmier(ère)') return null;

  const shifts = state.shifts
    .filter((s) => s.employeeId === me.id && s.date === day)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const removeAppt = async (id: string): Promise<void> => {
    try {
      await axios.delete(`${API}/appointments/${id}`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      toast.success('Rendez-vous supprimé.');
      await refresh();
    } catch {
      toast.error('Suppression impossible.');
    }
  };

  const dayLabel = dayDate.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div data-testid="nurse-day-panel" className="bg-white rounded-xl border border-slate-200 p-7">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h2 className="font-heading text-base font-bold text-slate-900 inline-flex items-center gap-2">
          <Stethoscope className="w-4 h-4 text-sky-600" /> Ma journée — Infirmière
        </h2>
        <div className="flex items-center gap-1.5">
          <button data-testid="nurse-day-prev" onClick={() => setOffset((o) => o - 1)} className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-500 hover:border-emerald-300 hover:text-emerald-700 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            data-testid="nurse-day-today"
            onClick={() => setOffset(0)}
            className={`px-3 h-8 rounded-full border text-xs font-semibold transition-colors ${offset === 0 ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600 hover:border-emerald-300'}`}
          >
            Aujourd'hui
          </button>
          <button data-testid="nurse-day-next" onClick={() => setOffset((o) => o + 1)} className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-500 hover:border-emerald-300 hover:text-emerald-700 transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <p data-testid="nurse-day-date" className="text-sm font-semibold text-slate-700 capitalize mb-4">{dayLabel}</p>

      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold mb-2">Plages de travail</p>
        {shifts.length === 0 ? (
          <p data-testid="nurse-day-no-shift" className="text-sm text-slate-500">Aucun quart planifié ce jour-là — les rendez-vous y sont bloqués.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {shifts.map((s) => (
              <span key={s.id} data-testid={`nurse-day-shift-${s.id}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-semibold">
                <Clock className="w-3 h-3" /> {s.startTime} – {s.endTime}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-2">
        <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold">Rendez-vous ({appointments.length})</p>
        <Button data-testid="nurse-day-add-appointment" size="sm" variant="outline" className="rounded-full text-xs border-sky-300 text-sky-800 hover:bg-sky-50" onClick={() => setApptOpen(true)}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Rendez-vous
        </Button>
      </div>
      {appointments.length === 0 ? (
        <p data-testid="nurse-day-empty" className="text-sm text-slate-500 py-2">Aucun rendez-vous ce jour-là.</p>
      ) : (
        <div className="space-y-2">
          {appointments.map((a) => (
            <div key={a.id} data-testid={`nurse-day-appt-${a.id}`} className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50/60 px-4 py-2.5">
              <span className="text-sm font-bold text-sky-900 whitespace-nowrap">{a.start}–{a.end}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800 truncate">{a.client_name}</p>
                <p className="text-xs text-slate-500 truncate">{a.reason || 'Consultation'}{a.notes ? ` · ${a.notes}` : ''}</p>
              </div>
              <button
                data-testid={`nurse-day-delete-${a.id}`}
                onClick={() => void removeAppt(a.id)}
                className="text-slate-400 hover:text-red-600 transition-colors shrink-0 mt-0.5"
                aria-label="Supprimer le rendez-vous"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <AppointmentDialog open={apptOpen} onOpenChange={setApptOpen} onCreated={() => void refresh()} />
    </div>
  );
};
