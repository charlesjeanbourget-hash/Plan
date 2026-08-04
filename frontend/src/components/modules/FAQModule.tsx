import { useState, FormEvent } from 'react';
import { useHR } from '@/context/HRContext';
import { useAuth } from '@/context/AuthContext';
import { ModuleHeader } from '@/components/modules/shared';
import { StarterGuides } from '@/components/modules/StarterGuides';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

export default function FAQModule(): JSX.Element {
  const { state, addFAQ } = useHR();
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role !== 'employee';
  const [dialogOpen, setDialogOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [category, setCategory] = useState('');

  const categories = Array.from(new Set(state.faqItems.map((f) => f.category)));

  const handleAdd = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    addFAQ({ question, answer, category: category || 'Général' });
    toast.success('Question ajoutée à la FAQ.');
    setDialogOpen(false);
    setQuestion(''); setAnswer(''); setCategory('');
  };

  return (
    <div data-testid="faq-module">
      <ModuleHeader
        title="Centre d'aide"
        subtitle="Guides de démarrage et réponses aux questions fréquentes de votre équipe."
        action={
          isAdmin ? (
            <Button data-testid="add-faq-button" onClick={() => setDialogOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-4 h-4 mr-1" /> Ajouter une question
            </Button>
          ) : undefined
        }
      />
      <Tabs defaultValue="guides">
        <TabsList className="mb-6">
          <TabsTrigger data-testid="tab-guides" value="guides">Guides de démarrage</TabsTrigger>
          <TabsTrigger data-testid="tab-faq" value="faq">Questions fréquentes</TabsTrigger>
        </TabsList>
        <TabsContent value="guides">
          <StarterGuides />
        </TabsContent>
        <TabsContent value="faq">
          <div className="max-w-3xl space-y-10">
            {categories.map((cat) => (
              <div key={cat}>
                <p className="text-xs uppercase tracking-[0.2em] text-emerald-700 font-bold mb-4">{cat}</p>
                <Accordion type="single" collapsible className="bg-white rounded-xl border border-slate-200 px-6">
                  {state.faqItems.filter((f) => f.category === cat).map((f) => (
                    <AccordionItem key={f.id} value={f.id}>
                      <AccordionTrigger data-testid={`faq-question-${f.id}`} className="text-left font-semibold text-slate-800 text-sm hover:text-emerald-700">
                        {f.question}
                      </AccordionTrigger>
                      <AccordionContent className="text-sm text-slate-600">{f.answer}</AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="add-faq-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvelle question FAQ</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-2">
              <Label>Catégorie</Label>
              <Input data-testid="faq-category-input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ex. : Paie" />
            </div>
            <div className="space-y-2">
              <Label>Question</Label>
              <Input data-testid="faq-question-input" value={question} onChange={(e) => setQuestion(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Réponse</Label>
              <Textarea data-testid="faq-answer-input" value={answer} onChange={(e) => setAnswer(e.target.value)} rows={4} required />
            </div>
            <Button data-testid="faq-submit-button" type="submit" className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700">
              Ajouter
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
