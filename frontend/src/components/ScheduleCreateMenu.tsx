import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Plus, Sparkles, Stethoscope, TreePalm, Megaphone, Building2 } from 'lucide-react';
import { openSection } from '@/components/modules/shared';

interface Props {
  onCreateShift: () => void;
  onCreateLeave: () => void;
  onCreateAppointment: () => void;
  onCreateAgencyRequest?: () => void;
  canCreateAppointment: boolean;
}

export function ScheduleCreateMenu({ onCreateShift, onCreateLeave, onCreateAppointment, onCreateAgencyRequest, canCreateAppointment }: Props): JSX.Element {
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
          <DropdownMenuItem data-testid="create-leave-item" onClick={onCreateLeave}>
            <TreePalm className="w-4 h-4 mr-2 text-amber-600" /> Absence / congé
          </DropdownMenuItem>
          {canCreateAppointment && (
            <DropdownMenuItem data-testid="create-appt-item" onClick={onCreateAppointment}>
              <Stethoscope className="w-4 h-4 mr-2 text-sky-600" /> Rendez-vous
            </DropdownMenuItem>
          )}
          <DropdownMenuItem data-testid="create-open-shift-item" onClick={() => openSection('sched-open-shifts')}>
            <Megaphone className="w-4 h-4 mr-2 text-bronze-600" /> Quart à combler
          </DropdownMenuItem>
          {onCreateAgencyRequest && (
            <DropdownMenuItem data-testid="create-agency-item" onClick={onCreateAgencyRequest}>
              <Building2 className="w-4 h-4 mr-2 text-emerald-700" /> Demande aux agences
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button data-testid="generate-ai-button" variant="outline" onClick={() => openSection('sched-proposals')} className="rounded-full border-violet-300 text-violet-800 hover:bg-violet-50">
        <Sparkles className="w-4 h-4 mr-1" /> Générer avec l’IA
      </Button>
    </div>
  );
}
