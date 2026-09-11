import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Plus, Sparkles, Stethoscope, TreePalm, Megaphone } from 'lucide-react';
import { openSection } from '@/components/modules/shared';
import { requestNavigate } from '@/lib/nav';

interface Props {
  onCreateShift: () => void;
  onCreateAppointment: () => void;
  canCreateAppointment: boolean;
}

/** Barre Agendrix : Créer à la main + Générer avec l’IA. */
export function ScheduleCreateMenu({ onCreateShift, onCreateAppointment, canCreateAppointment }: Props): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2" data-testid="schedule-dual-path">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button data-testid="schedule-create-menu" className="rounded-full bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-1" /> Créer
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem data-testid="create-shift-item" onClick={onCreateShift}>
            <Plus className="w-4 h-4 mr-2 text-emerald-600" /> Quart de travail
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="create-leave-item" onClick={() => requestNavigate('vacations')}>
            <TreePalm className="w-4 h-4 mr-2 text-emerald-600" /> Congé
          </DropdownMenuItem>
          {canCreateAppointment && (
            <DropdownMenuItem data-testid="create-appt-item" onClick={onCreateAppointment}>
              <Stethoscope className="w-4 h-4 mr-2 text-sky-600" /> Rendez-vous
            </DropdownMenuItem>
          )}
          <DropdownMenuItem data-testid="create-open-shift-item" onClick={() => openSection('sched-open-shifts')}>
            <Megaphone className="w-4 h-4 mr-2 text-bronze-600" /> Quart à combler
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        data-testid="generate-ai-button"
        variant="outline"
        onClick={() => openSection('sched-proposals')}
        className="rounded-full border-violet-300 text-violet-800 hover:bg-violet-50"
      >
        <Sparkles className="w-4 h-4 mr-1" /> Générer avec l’IA
      </Button>
    </div>
  );
}
