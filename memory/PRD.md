# PRD — LuminaHR

## Problème original
Développer « LuminaHR », un SIRH complet conçu pour les pharmacies. SPA React + TypeScript strict (aucun `any`) + Tailwind CSS. Données simulées via Context API + localStorage (pas de backend pour les données RH). Navigation 100% fonctionnelle via un état de vue dans App.tsx. Interface 100% en français.

## Choix utilisateur
- Tout générer en une fois (pas d'itératif)
- Vraie IA pour le ChatWidget (GPT-5.4 via clé universelle Emergent)
- Français uniquement
- Solide et durable (visé : des centaines de clients pharmacies)

## Architecture
- **Frontend** : React (CRA + craco) + TypeScript 5.6 strict, Tailwind, shadcn/ui (avec fichiers `.d.ts` typés pour les composants utilisés)
- **Données RH** : `HRContext.tsx` (CRUD générique typé) + `AuthContext.tsx`, persistance localStorage (`luminahr_state_v1`, `luminahr_users_v1`, session `luminahr_session_v1`)
- **Types** : `/src/types.ts` — User, Employee, Shift, Task, JobOffer, Candidate, LeaveRequest, ReplacementRequest, PayrollEntry, PerformanceReview, OnboardingItem, Contract, Benefit, FAQItem, Pharmacy
- **Backend** (chat IA uniquement) : FastAPI `POST /api/chat` — SSE streaming, emergentintegrations LlmChat gpt-5.4, historique en MongoDB (`chat_messages`)
- **Routage** : état `currentView` dans App.tsx : landing | login | careers | agency | dashboard ; `activeModule` pour les 13 modules
- **Design** : thème émeraude/slate/orange, polices Manrope (titres) + Figtree (corps), guidelines dans `/app/design_guidelines.json`

## Personas
- **Admin / pharmacien(ne)-propriétaire** : accès aux 13 modules
- **Employé(e)** : accès restreint (tableau de bord, horaires, vacances, avantages, FAQ)
- **Superadmin** : gestion des pharmacies clientes
- **Candidat public** : Portail Carrières
- **Agence de placement** : Portail Agence (code AGENCE2024)

## Implémenté (30 juin 2026) — testé à 100% (iteration_1.json)
- Landing page (3 cartes d'action), Login, Portail Carrières (candidature), Portail Agence (gate + propositions)
- Sidebar 13 modules + filtrage par rôle + déconnexion + version mobile
- Modules : Tableau de bord (KPIs, quarts, tâches), Employés (CRUD + fiche), Horaires (grille hebdo + navigation + ajout/suppression quarts), Recrutement (offres + toggle + pipeline candidats), Paie (tableau + statuts), Remplacements (cycle Ouverte→Proposée→Comblée/Annulée), Vacances (approbation), Performance (évaluations étoilées), Onboarding (checklists + %), Contrats (signature), Avantages sociaux (adhésions), FAQ (accordéon + ajout), Superadmin (pharmacies + reset données)
- ChatWidget IA flottant avec streaming SSE mot à mot
- ErrorBoundary, toasts sonner, data-testid partout, tsc --noEmit sans erreur

## Identifiants (voir /app/memory/test_credentials.md)
admin@luminahr.ca/admin123 · julie@luminahr.ca/employe123 · super@luminahr.ca/super123 · code agence AGENCE2024

## Backlog priorisé
- **P0** : —
- **P1** : Vue « Mon espace » employé enrichie (mes quarts, mes paies), export PDF des relevés de paie, calendrier visuel des vacances
- **P2** : Notifications internes, échange de quarts entre employés, multi-pharmacie réel pour le superadmin (données par pharmacie), mode sombre, DialogDescription pour l'accessibilité Radix

## Notes techniques
- Ne jamais recréer `jsconfig.json` (conflit CRA avec tsconfig.json)
- npm interdit — yarn uniquement
- Les `.d.ts` dans `src/components/ui/` typent les composants shadcn `.jsx` pour le mode strict
