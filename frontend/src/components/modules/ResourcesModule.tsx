import { useState, FormEvent } from 'react';
import { useHR } from '@/context/HRContext';
import { Resource, ResourceType } from '@/types';
import { ModuleHeader, EmptyState } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, MapPin, Wrench, Pencil, Trash2, ExternalLink, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';

type Filter = 'all' | ResourceType;

export default function ResourcesModule(): JSX.Element {
  const { state, addResource, updateResource, deleteResource } = useHR();
  const [filter, setFilter] = useState<Filter>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [type, setType] = useState<ResourceType>('lieu');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');

  const resources = (state.resources ?? []).filter((r) => filter === 'all' || r.type === filter);

  const usageCount = (id: string): number =>
    state.shifts.filter((s) => (s.resourceIds ?? []).includes(id)).length;

  const openCreate = (): void => {
    setEditId(null);
    setType('lieu');
    setName('');
    setAddress('');
    setDescription('');
    setDialogOpen(true);
  };

  const openEdit = (r: Resource): void => {
    setEditId(r.id);
    setType(r.type);
    setName(r.name);
    setAddress(r.address ?? '');
    setDescription(r.description ?? '');
    setDialogOpen(true);
  };

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!name.trim()) return;
    const payload = { type, name: name.trim(), address: address.trim(), description: description.trim() };
    if (editId) {
      updateResource(editId, payload);
      toast.success('Ressource mise à jour.');
    } else {
      addResource(payload);
      toast.success(`${type === 'lieu' ? 'Lieu de travail' : 'Équipement'} « ${name.trim()} » créé.`);
    }
    setDialogOpen(false);
  };

  const remove = (r: Resource): void => {
    deleteResource(r.id);
    toast.success(`« ${r.name} » supprimé et retiré des quarts.`);
  };

  return (
    <div data-testid="resources-module">
      <ModuleHeader
        title="Ressources"
        subtitle="Lieux de travail et équipements à affecter aux quarts de travail."
        action={
          <Button data-testid="add-resource-button" onClick={openCreate} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-1" /> Nouvelle ressource
          </Button>
        }
      />
      <div className="flex flex-wrap gap-2 mb-6">
        {([['all', 'Toutes'], ['lieu', 'Lieux de travail'], ['equipement', 'Équipements']] as [Filter, string][]).map(([key, label]) => (
          <button
            key={key}
            data-testid={`resources-filter-${key}`}
            onClick={() => setFilter(key)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
              filter === key ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {resources.length === 0 ? (
        <EmptyState text="Aucune ressource. Créez un lieu de travail ou un équipement à affecter aux quarts." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {resources.map((r) => (
            <div key={r.id} data-testid={`resource-card-${r.id}`} className="bg-white rounded-xl border border-slate-200 p-5 hover:border-bronze-300 transition-colors">
              <div className="flex items-start justify-between gap-2 mb-3">
                <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${r.type === 'lieu' ? 'bg-emerald-50' : 'bg-bronze-100'}`}>
                  {r.type === 'lieu'
                    ? <MapPin className="w-5 h-5 text-emerald-600" />
                    : <Wrench className="w-5 h-5 text-bronze-700" />}
                </span>
                <div className="flex gap-1">
                  <Button data-testid={`edit-resource-${r.id}`} size="sm" variant="outline" onClick={() => openEdit(r)} className="rounded-full h-8 w-8 p-0">
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button data-testid={`delete-resource-${r.id}`} size="sm" variant="outline" onClick={() => remove(r)} className="rounded-full h-8 w-8 p-0 text-red-600 border-red-200 hover:bg-red-50">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <p className="font-heading font-bold text-slate-900">{r.name}</p>
              <p className="text-xs text-slate-500 mb-1">{r.type === 'lieu' ? 'Lieu de travail' : 'Équipement'}</p>
              {r.address && (
                <a
                  data-testid={`resource-map-link-${r.id}`}
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.address)}`}
                  target="_blank" rel="noreferrer"
                  className="text-xs text-emerald-700 hover:underline inline-flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" /> {r.address}
                </a>
              )}
              {r.description && <p className="text-xs text-slate-500 mt-1">{r.description}</p>}
              <p className="text-xs text-slate-400 mt-3 inline-flex items-center gap-1">
                <CalendarClock className="w-3 h-3" /> Affectée à {usageCount(r.id)} quart(s)
              </p>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-400 mt-6">
        Affectez ces ressources à un quart depuis le module Horaires (bouton « Nouveau quart »). Elles s'affichent ensuite directement sur la grille.
      </p>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="resource-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">{editId ? 'Modifier la ressource' : 'Nouvelle ressource'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as ResourceType)}>
                <SelectTrigger data-testid="resource-type-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lieu">Lieu de travail (succursale, client, entrepôt…)</SelectItem>
                  <SelectItem value="equipement">Équipement (véhicule, tablette, chariot…)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Nom *</Label>
              <Input data-testid="resource-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'lieu' ? 'Ex. Succursale Centre-Ville' : 'Ex. Véhicule de livraison #1'} required />
            </div>
            {type === 'lieu' && (
              <div className="space-y-2">
                <Label>Adresse</Label>
                <Input data-testid="resource-address-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="1200 rue Sainte-Catherine, Montréal" />
              </div>
            )}
            <div className="space-y-2">
              <Label>Description</Label>
              <Input data-testid="resource-description-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Détails utiles pour l'équipe (optionnel)" />
            </div>
            <Button data-testid="resource-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              {editId ? 'Enregistrer' : 'Créer la ressource'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
