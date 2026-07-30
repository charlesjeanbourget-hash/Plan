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
- **P0** : Fournir RESEND_API_KEY (resend.com) pour activer l'envoi réel des rapports mensuels
- **P1** : Vue succursale généralisée (filtres dans Horaires/Paie), notifications internes, mode sombre
- **P2** : Multi-pharmacie réel pour superadmin (données par pharmacie), échange de quarts entre employés sans gestionnaire, DialogDescription accessibilité Radix

## Itération 2 (30 juin 2026) — testée à 100% (iteration_2.json : backend 14/14, frontend 14/14)
- **Licences professionnelles (Loi 25)** : backend FastAPI + MongoDB + Object Store Emergent. Accès admin/superadmin via headers (X-User-Email/X-User-Role/X-Pharmacy-Id), 403 sinon. Isolation par pharmacie (admin ph1 ne voit pas ph2). Upload certificats PDF/images (max 10 Mo) dans le coffre sécurisé, consultation via blob. Journal d'audit invisible (chaque consultation/modification loggée : CONSULTATION_LISTE, CREATION, MODIFICATION, CONSULTATION_CERTIFICAT, DROIT_A_L_OUBLI, ENVOI_RAPPORT…) visible uniquement par superadmin. Droit à l'oubli : destruction définitive licences+documents + retrait optionnel des dossiers RH. Rapport mensuel auto (APScheduler, 1er du mois 8h heure de Montréal) par Resend — RESEND_API_KEY vide → erreur 400 explicite, à fournir par l'utilisateur. Paramètres destinataire/activation par pharmacie.
- **Multi-comptes** : 2 superadmins (jeffmenard78@hotmail.com/jeff2026, charles-jbourget@hotmail.com/charles2026), admin lié à sa pharmacie (pharmacyId), succursales (br1 Centre-Ville, br2 Plateau), employés rattachés à une succursale, filtre succursale dans Licences. localStorage v2.
- **Mon espace** (employés) : mes quarts, mes relevés de paie (PDF), mes congés + demande, mes échanges de quarts + proposition.
- **Calendrier Vacances** : grille mensuelle des congés approuvés avec navigation mois et chips colorés par employé.
- **Relevés PDF** : jsPDF format québécois (brut, impôts féd./prov., RRQ, AE, RQAP, net) dans Paie (admin) et Mon espace.
- **Échange de quarts** : demande employé → panneau dans Horaires → approbation 1 clic réassigne le quart partout (interconnexion HRContext).

## Itération 3 (30 juin 2026) — testée (backend 17/17 + re-test lockout, frontend 12/12)
- **Authentification JWT serveur** : users MongoDB + bcrypt, POST /api/auth/login (jeton 7 jours), GET /api/auth/me, POST /api/auth/change-password, verrouillage anti-brute-force par email (5 échecs → 429 15 min, Retry-After), seed idempotent de 5 comptes. Routes licences protégées par Bearer (fini les headers X-User-*). AuthContext v3 (localStorage luminahr_auth_v3, revalidation /auth/me au montage, déconnexion seulement sur 401/403). Dialog « Mot de passe » dans la sidebar avec pastille ambre si mot de passe temporaire.
- **Comptes** : admin@luminahr.ca/admin123 · julie@luminahr.ca/employe123 · superadmins temporaires : jeffmenard78@hotmail.com/Lumina-Jeff!2941, charles-jbourget@hotmail.com/Lumina-Charles!7358, charlesjeanbourget@gmail.com/Lumina-Owner!5127
- **Alertes licences** : bannière + pastille animée sur le tableau de bord (admin/superadmin) si licences ≤60 jours.
- **Filtres succursales** : Horaires, Paie (totaux recalculés) et Dossiers employés.
- **Resend ACTIVÉ** : clé réelle dans backend/.env, envoi de rapport testé avec succès vers charlesjeanbourget@gmail.com. Attention mode test Resend : livraison limitée à l'adresse du propriétaire du compte tant qu'aucun domaine n'est vérifié.

## Itération 4 (30 juin 2026) — testée à 100% (iteration_5.json : backend 26/26, frontend tous flux critiques)
- **Gestion des comptes (superadmin)** : module SuperadminUsers + routes /api/admin/users — créer un compte (mot de passe temporaire 15 car. affiché en modal), réinitialiser le mot de passe (support à distance), suspendre/réactiver (login 403 « Compte suspendu »), supprimer. Garde-fous : impossible de se suspendre/supprimer soi-même. Audit loggé.
- **Rappels licences 30 jours** : job quotidien 8h30 (America/Montreal) — courriel Resend envoyé directement à employee_email si expiration ≤30 j, dédupliqué par expiry_date (reminder_sent_for). Déclenchement manuel POST /api/licenses/reminders/run → {sent: N}.
- **Relevés PDF historiques** : sélecteur de périodes de paie passées dans Paie (admin) et Mon espace (employé), cumulatifs annuels (YTD) réels calculés sur les périodes de l'année.
- Fix : import `Branch` manquant dans HRContext.tsx (tsc --noEmit propre).
- Mots de passe temporaires superadmin communiqués à l'utilisateur.
- Bouton œil (afficher/masquer) sur les champs mot de passe : page de connexion + dialogue « Changer mon mot de passe » (30 juin 2026).
- Fix login copier-coller (30 juin 2026, iteration_6.json — backend 30/30, frontend 100%) : trim des espaces autour du courriel et du mot de passe au login et au changement de mot de passe (backend + frontend). Cause du « mot de passe ne marche pas » signalé pour charlesjeanbourget@gmail.com : espace collé avec le mot de passe — les identifiants Lumina-Owner!5127 fonctionnent, vérifié E2E.

## Backlog technique (suggestions revue de code, non bloquant)
- Throttle sur POST /api/licenses/reminders/run (1 exécution/min) et plafond de reprises Resend en cas d'échec transitoire (éviter renvois en boucle).

## Itération 5 (30 juin 2026) — testée à 100% (iteration_7.json : backend 45/45, frontend tous flux)
- **Formations par IA** : l'admin dépose un dossier de formation PDF (max 15 Mo) → gpt-5.4 (clé Emergent) découpe le contenu par secteur (ouverture, comptage des pilules, nettoyage, savoir-être, conformité…) + génère un examen QCM (10-15 questions, 4 choix). Statuts processing→draft→published (polling 5 s). Admin révise/édite sections & questions, note de passage (défaut 80 %), publie/dépublie, consulte les résultats. Employé : lecture par accordéon + points clés, examen à choix multiples (réponses cachées côté serveur), corrigé après soumission, reprises illimitées. PDF stocké dans l'Object Store, audit complet. Formation démo publiée : « Formation d'intégration Proxim » (6 sections, 14 questions).
- **Cloche de notifications** (fixe en haut à droite) : admin → congés en attente, échanges de quarts, licences expirantes ; employé → statuts de ses demandes + formations à compléter. Lu/non-lu persistant par utilisateur (localStorage), navigation au clic.
- **Tableau superadmin global** : GET /api/superadmin/overview — par pharmacie : comptes (admins/employés/suspendus), licences (total/≤60j/≤30j/expirées), formations, rapport mensuel activé + 4 StatCards globales.
- **Expéditeur courriel configurable** : GET/POST /api/email-settings (édition superadmin), utilisé par les rapports mensuels et rappels 30 j. Défaut : LuminaHR <onboarding@resend.dev>. Une fois le domaine vérifié sur resend.com/domains, entrer l'adresse du domaine dans le panneau du module Superadmin.
- Nouveaux fichiers : TrainingModule/TrainingEditor/TrainingViewer.tsx, NotificationBell.tsx, SuperadminOverview.tsx, popover.d.ts. Dépendance backend : pypdf.

## Itération 6 (30 juin 2026) — testée à 100% (iteration_8.json : backend 54/54, frontend tous flux)
- **Certificat de réussite PDF** (jsPDF paysage, bordures émeraude/ambre) : téléchargeable sur l'écran de résultat après réussite ET depuis la bannière « déjà réussi » (meilleure tentative récupérée via l'API). Nom, formation, score, note de passage, date, pharmacie, ligne de signature.
- **Assignation de formations** : onglet « Assignations » dans l'éditeur admin — sélection d'un employé + date limite, table avec statuts calculés (Réussie/score, En retard, En attente), retrait. Relances courriel automatiques (job quotidien 8h45 America/Montreal) à ≤7 jours de l'échéance et en retard, dédupliquées par due_date, tant que l'examen n'est pas réussi. Bouton « Envoyer les relances maintenant » (POST /api/trainings/assignments/reminders/run, portée limitée à la pharmacie de l'admin). Puces d'échéance sur les cartes employé + notifications cloche « Formation en retard » (rouge).
- **Onboarding lié** : à la réussite de l'examen, les étapes d'onboarding de catégorie « Formation » de l'employé sont cochées automatiquement (toast). Seed v4 (STATE_KEY luminahr_state_v4) avec item o8 pour Julie.
- Correctifs revue de code : validation format date (400), portée pharmacie des relances manuelles. NOTE : le testing agent avait écrasé la bannière d'échéance du viewer — re-ajoutée et vérifiée.
- Assignation démo : Julie → Formation Proxim, échéance 2026-08-05 (réussie à 100 %).

## Itération 7 (30 juin 2026) — testée à 100% (iteration_9.json : backend 68/68, frontend tous flux)
- **Profils employés (MongoDB, synchro admin↔employé)** : disponibilités par jour (switch + plage horaire), heures min/max par semaine, rôles (22 rôles de pharmacie), capacités/tâches (28 tâches), restrictions (10 prédéfinies + libres), notes. Éditables par l'employé (Mon espace) ET l'admin (Dossiers employés). ProfileEditor partagé.
- **Système de punch** : NIP personnel 4 chiffres (généré/réinitialisé par l'admin, affiché dans le profil). Borne kiosque publique (page d'accueil → « Borne de punch », pavé numérique sombre) + punch depuis Mon espace (MyPunchCard). Saisie manuelle admin journalisée. Anti-énumération : 5 NIP invalides par IP → verrou 15 min (429). Panneau « Heures punchées » dans Paie : résumé par employé (punchées/manuelles/total), détails avec suppression, création d'entrée de paie à partir des heures punchées UNIQUEMENT (gross = h × taux, déductions 25 %).
- **Période de paie configurable** : hebdomadaire ou aux 2 semaines + date d'ancrage (choix du client admin), navigation entre périodes.
- **Horaires générés par IA (gpt-5.4) avec double approbation** : l'admin fournit semaine + consignes + délai (24/48/72h/7j) ; l'IA respecte les profils (vérifié : Julie sans mercredi/soir/week-end, 24 h dans sa fourchette). Admin approuve → chaque employé approuve/refuse depuis Mon espace (avec commentaire) → approbation tacite au délai écoulé sans refus → « Appliquer à l'horaire » (bloqué 400 sinon — fix testé) ajoute les quarts à la grille. Notification cloche « Horaire à approuver » pour les employés.
- Données démo : NIP Julie (e2) 7068, NIP Karim (e3) 1976, proposition cb21ac33 (semaine 2026-08-03 : admin ✓, Julie ✓, e1/e3 en attente).
- Nouveaux fichiers : ProfileEditor, PunchKiosk, MyPunchCard, MyProposalsPanel, ScheduleProposals, PunchHoursPanel (.tsx) + lib/pharmacy.ts.

## Itération 8 (30 juin 2026) — testée à 100% (iteration_10.json : backend 21/21, frontend tous flux)
- **Évaluations de performance + suggestion salariale BAIIA** : admin lance une évaluation (employé, taux actuel prérempli, % BAIIA) → questionnaire employeur 10 critères (notes 1-5, RatingScale) + points forts/à améliorer/objectifs → employé complète son auto-évaluation 8 questions dans Mon espace (MyEvaluationsPanel) → suggestion auto : score global = 70% employeur + 30% auto ; multiplicateur ≥90→×1.2, 75-89→×1.0, 60-74→×0.7, 45-59→×0.4, <45→0 ; taux suggéré arrondi au 0,05 $ → admin propose un taux → employé accepte/refuse avec commentaire (refus → re-proposition possible) → « Appliquer au dossier » (synchro hourly_rate profil Mongo + dossier RH local). Endpoints /api/evaluations (+/employer,/self,/propose,/respond,/applied), RBAC vérifié (403/400).
- **Agences de remplacement** : module Remplacements refait (onglets Demandes / Agences partenaires). Agences (nom, courriel, postes couverts en puces). Demande (poste, urgence, plages multiples, notes) → courriels Resend automatiques aux agences couvrant le poste avec **lien public unique** `/?remplacement=TOKEN` → page publique sans connexion (PublicReplacementPage) : consultation + soumission d'offre (candidat, licence, exp., taux, contact) → admin compare les offres et « Retenir » → statuts chosen/declined + courriels de décision à toutes les agences (retenue/comblée) → demande « Comblée » (nouvelle offre → 400). Copier le lien public depuis la carte.
- **Punch amélioré** : confirmation d'identité à la borne (POST /api/punch/preview → « Êtes-vous bien {nom} ? » entrée/sortie, confirmer/annuler avant enregistrement) ; export CSV des heures (GET /api/punches/export, BOM UTF-8, journalisé) ; colonne « Temps supp. » (>40 h/sem, calcul ISO-semaine) ; bannière rouge « punch oublié » (entrées ouvertes ≥12 h via /api/punches/open) avec clôture rapide à une heure choisie (PUT /api/punches/{id}, journalisé).
- **Formations par texte** : toggle « À partir d'un PDF / À partir d'un texte » dans le dialogue de création — POST /api/trainings/manual (min 200 caractères, compteur), même pipeline IA gpt-5.4 (sections + examen). Les formations restent modifiables en tout temps via l'éditeur (déjà en place).
- Nouveaux fichiers : EvaluationDetail.tsx, MyEvaluationsPanel.tsx, RatingScale.tsx, PublicReplacementPage.tsx ; réécrits : PerformanceModule.tsx, ReplacementModule.tsx, PunchKiosk.tsx ; lib/evaluations.ts (questions + MULTIPLIER_GRID).
- Fix post-test : payload de POST /replacements/requests/{id}/choose renvoie maintenant l'offre avec status='chosen' (vérifié curl).

## Itération 9 (30 juin 2026) — Rebrand « Arrière Plan » + 3 features — testée à 100 % (iteration_11.json)
- **REBRAND complet LuminaHR → Arrière Plan** : nouveau logo (src/assets/logo-arriere-plan.png, composant BrandLogo avec wordmark « Arrière Plan »), palette blanc dominant + vert jade (emerald conservé) + **bronze/or** (nouvelle échelle Tailwind `bronze` 50-950, guidelines dans /app/design_guidelines.json). Toutes les pages restylées : landing (header blanc, cartes blanches hover bronze), login (logo + halos vert/bronze), **borne de punch passée en thème clair** (carte blanche + logo), portail agence passé en clair, portail carrières, page publique remplacement (header blanc + logo), **sidebar blanche** (item actif vert à barre latérale, rôle en bronze), barre dégradée vert→bronze sur tous les en-têtes de modules, badges « En attente » en bronze, carte suggestion BAIIA blanche à liseré bronze, PDF (relevés de paie liseré bronze, certificats bordure bronze), courriels renommés. Emails de connexion inchangés (@luminahr.ca). Nom interne APP_NAME (chemins storage) inchangé volontairement.
- **Rappels d'auto-évaluation** : courriel automatique quotidien (9 h, cron APScheduler) à l'employé quand son auto-évaluation traîne ≥3 jours (anti-doublon self_reminder_at, relance max q3j) + endpoint manuel POST /api/evaluations/reminders/run + notifications cloche employé (« Auto-évaluation à compléter », « Proposition salariale reçue » → naviguent vers Mon espace).
- **Historique salarial** : panneau SalaryHistory dans le dossier employé (admin) — taux actuel + chaque changement issu des évaluations (ancien → nouveau taux, % d'augmentation, score de performance, statut accepté/appliqué).
- **Remplaçant à l'horaire** : GET /replacements/requests enrichi de chosen_offer ; la grille Horaires (admin) affiche une ligne « Remplaçants (agence) » avec puces bronze (heures + candidat + rôle) aux dates comblées ; la carte de demande affiche « Retenu : candidat (agence) ».
- Nouveaux fichiers : BrandLogo.tsx, SalaryHistory.tsx, assets.d.ts, assets/logo-arriere-plan.png ; réécrits : LandingPage, Sidebar, PunchKiosk (clair), AgencyPortal (clair).

## Itération 10 (30 juin 2026) — Typographie premium + responsive + favicon — testée (iteration_12.json, ~97 % → 100 % après correctif)
- **Nouvelle typographie « haut de gamme »** : titres en **Fraunces** (serif éditorial, letter-spacing -0.015em) + corps en **Archivo**, chargées via <link> dans public/index.html (Manrope/Figtree retirées, @import CSS supprimé).
- **Favicon** : logo Arrière Plan recadré (emblème carré) → public/favicon.png (256), favicon.ico, apple-touch-icon.png (180) ; index.html : lang="fr", title « Arrière Plan — SIRH pour pharmacies », theme-color #059669, meta description.
- **Responsive complet (390/768/1920)** : BrandLogo responsive + wordmark masqué <480px dans les headers publics (prop hideTextOnSmall) ; header landing compact mobile ; main de l'app avec pt-20 mobile (plus de chevauchement hamburger/cloche) ; flex-wrap sur les contrôles (Paie, Horaires, Licences) ; select pleine largeur mobile ; paddings réduits mobile (login, cartes landing, page publique agence) ; ProfileEditor : lignes de disponibilités wrap + inputs réduits (corrige les 33px de scroll horizontal sur Employés / Mon espace).
- Validé par testing agent aux 3 viewports sur TOUTES les pages (14 modules admin, pages publiques, kiosque, portails, cloche, dialogues).

## Itération 11 (30 juin 2026) — Landing complète, Tâches par quart, Logo PDF, Comparatif d'équipe, PWA — testée 100 % (iteration_13.json : backend 11/11, frontend tout passe)
- **Page d'accueil refaite** : accent « sauver du temps de qualité pour des tâches plus payantes » — hero « Moins de paperasse. Plus de temps pour ce qui rapporte. », section ROI (3 promesses), grille de 12 cartes couvrant TOUTES les fonctionnalités (horaires IA, punch, paie PDF, tâches par quart, remplacements/agences, évaluations BAIIA, formations IA, licences Loi 25, recrutement, vacances, onboarding/contrats, assistant IA), section « Votre temps vaut plus que l'administration » avec CTA vert.
- **NOUVEAU module « Tâches par quart »** (sidebar admin + employés) : l'admin distribue les tâches de la semaine (jour + quart Matin/Après-midi/Soir, assignées à un employé ou « Toute l'équipe »), bouton « Dupliquer la semaine précédente » (idempotent), navigation de semaine, barre de progression X/N ; les employés cochent (done_by + heure, re-toggle possible), ne voient que leurs tâches + celles d'équipe, 403 si tâche d'un autre, création/suppression réservées admin. Endpoints : GET/POST /api/tasks, POST /api/tasks/copy-week, POST /api/tasks/{id}/toggle, DELETE /api/tasks/{id} (collection shift_tasks, audit journalisé).
- **Logo sur les PDF** : lib/logoData.ts (logo → canvas → dataURL JPEG mis en cache) ; relevés de paie (logo en-tête gauche + « Relevé de paie » à droite + ligne bronze) et certificats (logo centré) — downloadPayStub/downloadCertificate désormais async.
- **Comparatif d'équipe** (module Performance, admin) : tableau classé par score global (dernière évaluation par employé), trophées top 3, colonnes employeur/auto/global/augmentation suggérée/statut.
- **PWA installable** : public/manifest.json (« Arrière Plan », standalone, icônes 192/512 générées du logo), sw.js minimal enregistré dans index.tsx, metas Apple → ajout à l'écran d'accueil iOS/Android pour puncher et voir l'horaire.

## Itération 12 (30 juin 2026) — Tâches récurrentes + rappels de fin de quart — testée (curl backend complet + screenshot UI)
- **Tâches récurrentes « chaque semaine »** : case « Se répète chaque semaine » à la création (champ recurring + series_id) ; matérialisation automatique et idempotente à la lecture (GET /api/tasks crée l'instance de la semaine demandée si absente, même jour + même quart, max 31 jours de plage) ; icône Repeat bronze sur la tâche (admin : clic pour activer/désactiver la série via PUT /api/tasks/{id}/recurring — propagé à toutes les instances) ; supprimer une tâche récurrente arrête aussi la série (series_stopped) pour éviter les réapparitions.
- **Rappels de fin de quart** : courriel automatique au(x) gestionnaire(s) de la pharmacie listant les tâches NON cochées du quart — crons America/Montreal : Matin 12 h, Après-midi 17 h, Soir 21 h 30 ; endpoint manuel POST /api/tasks/reminders/run?shift=&date= → {sent, par_quart} ; audit journalisé. Vérifié : l'envoi est bien tenté (bloqué seulement par le mode test Resend qui n'autorise que l'adresse du propriétaire — connu, en attente de vérification du domaine).
- UI : sous-titre admin mentionne les heures d'envoi ; toasts adaptés ; testids task-recurring-checkbox / task-recurring-toggle-{id}.

## Notes techniques
- Ne jamais recréer `jsconfig.json` (conflit CRA avec tsconfig.json)
- npm interdit — yarn uniquement
- Les `.d.ts` dans `src/components/ui/` typent les composants shadcn `.jsx` pour le mode strict
