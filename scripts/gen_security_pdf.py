from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
                                Table, TableStyle, Image, HRFlowable, KeepTogether)

EMERALD = HexColor("#059669")
EMERALD_DARK = HexColor("#065f46")
SLATE = HexColor("#0f172a")
SLATE_MID = HexColor("#475569")
SLATE_LIGHT = HexColor("#94a3b8")
BRONZE = HexColor("#b45309")
BG_SOFT = HexColor("#f0fdf4")
BG_CARD = HexColor("#f8fafc")
BORDER = HexColor("#e2e8f0")

OUT = "/app/frontend/public/dossier-securite-loi25.pdf"
LOGO = "/app/frontend/src/assets/logo-arriere-plan.png"

s_title = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=24, leading=29, textColor=SLATE)
s_subtitle = ParagraphStyle("subtitle", fontName="Helvetica", fontSize=11.5, leading=16, textColor=SLATE_MID)
s_h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=14.5, leading=18, textColor=EMERALD_DARK, spaceBefore=14, spaceAfter=6)
s_h2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=SLATE)
s_body = ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=SLATE_MID)
s_bullet = ParagraphStyle("bullet", parent=s_body, leftIndent=10, bulletIndent=2, spaceAfter=2.5)
s_cell_k = ParagraphStyle("cellk", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=SLATE)
s_cell_v = ParagraphStyle("cellv", fontName="Helvetica", fontSize=9, leading=12, textColor=SLATE_MID)
s_quote = ParagraphStyle("quote", fontName="Helvetica-Oblique", fontSize=10, leading=15, textColor=EMERALD_DARK)
s_badge = ParagraphStyle("badge", fontName="Helvetica-Bold", fontSize=8.5, leading=11, textColor=white, alignment=TA_CENTER)


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(EMERALD)
    canvas.rect(0, LETTER[1] - 6 * mm, LETTER[0], 6 * mm, stroke=0, fill=1)
    canvas.setFillColor(SLATE_LIGHT)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(18 * mm, 10 * mm, "Arrière Plan — Dossier de sécurité et de conformité · Confidentiel")
    canvas.drawRightString(LETTER[0] - 18 * mm, 10 * mm, f"Page {doc.page}")
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(18 * mm, 14 * mm, LETTER[0] - 18 * mm, 14 * mm)
    canvas.restoreState()


doc = BaseDocTemplate(OUT, pagesize=LETTER,
                      leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=20 * mm,
                      title="Arrière Plan — Dossier de sécurité et de conformité Loi 25",
                      author="Arrière Plan")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=header_footer)])

story = []

logo = Image(LOGO, width=52 * mm, height=52 * mm * 752 / 1379)
logo.hAlign = "LEFT"
story.append(logo)
story.append(Spacer(1, 6))
story.append(Paragraph("Dossier de sécurité et de conformité", s_title))
story.append(Spacer(1, 3))
story.append(Paragraph("Protection des renseignements personnels · Conformité Loi 25 · Sécurité applicative", s_subtitle))
story.append(Spacer(1, 4))
story.append(Paragraph("Document de référence — Juin 2026 · arriereplanrh.com", ParagraphStyle("d", parent=s_subtitle, fontSize=9, textColor=SLATE_LIGHT)))
story.append(Spacer(1, 8))
story.append(HRFlowable(width="100%", thickness=2, color=EMERALD))
story.append(Spacer(1, 4))


def section(num, title):
    story.append(Paragraph(f"{num}.&nbsp;&nbsp;{title}", s_h1))


def bullets(items):
    for it in items:
        story.append(Paragraph(it, s_bullet, bulletText="•"))


def card_table(rows, col1=52 * mm):
    data = [[Paragraph(k, s_cell_k), Paragraph(v, s_cell_v)] for k, v in rows]
    t = Table(data, colWidths=[col1, doc.width - col1], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), BG_SOFT),
        ("ROWBACKGROUNDS", (1, 0), (1, -1), [white, BG_CARD]),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
    ]))
    story.append(t)


# 1. Loi 25
section(1, "Conformité à la Loi 25 (Québec)")
story.append(Paragraph("Consentement explicite", s_h2))
bullets(["À la première connexion, chaque utilisateur doit lire et accepter la politique de confidentialité "
         "avant d'accéder à la plateforme (consentement horodaté et conservé au dossier)."])
story.append(Spacer(1, 4))
story.append(Paragraph("Droit à l'oubli (anonymisation)", s_h2))
bullets(["Anonymisation complète d'un ancien employé en un clic : nom remplacé par un identifiant neutre, "
         "courriel désactivé, compte suspendu, notes effacées, pointages et licences anonymisés.",
         "Chaque anonymisation est elle-même inscrite au journal d'audit avec le détail des données touchées."])
story.append(Spacer(1, 4))
story.append(Paragraph("Journal d'audit inaltérable", s_h2))
bullets(["Plus de 140 points d'audit : chaque action sensible (connexion, modification de dossier, export de paie, "
         "changement de politique de sécurité, anonymisation, consultation de documents…) est enregistrée avec "
         "l'auteur, son rôle, la date et le détail de l'action.",
         "Permet de démontrer en tout temps <i>qui a fait quoi, quand</i> — exigence centrale de la Loi 25 en cas d'incident."])
story.append(Spacer(1, 4))
story.append(Paragraph("Minimisation et cloisonnement des données", s_h2))
bullets(["Chaque pharmacie ne voit que ses propres données (cloisonnement strict par organisation).",
         "Les employés n'accèdent qu'à leurs propres renseignements (libre-service « Mon espace »)."])
story.append(Spacer(1, 4))
story.append(Paragraph("Traçabilité des incidents", s_h2))
bullets(["Détection des connexions depuis une nouvelle adresse IP avec alerte automatique — identification rapide "
         "d'un accès non autorisé (obligation de notification des incidents de confidentialité)."])

# 2. Auth
section(2, "Sécurité des comptes et de l'authentification")
card_table([
    ("Mots de passe hachés (bcrypt)", "Hachés avec bcrypt (algorithme de hachage renforcé) — jamais stockés en clair ; "
     "même l'équipe technique ne peut pas les lire."),
    ("Vérification en 2 étapes (MFA — authentification multifacteur)",
     "Codes TOTP (mot de passe à usage unique basé sur le temps) compatibles Google Authenticator ; "
     "secrets MFA chiffrés en base de données."),
    ("MFA imposable", "L'administrateur peut exiger la MFA pour tous les comptes de la pharmacie."),
    ("Politique de mot de passe configurable", "Longueur minimale, majuscule / minuscule / chiffre / caractère spécial, "
     "expiration (90 j, 180 j ou 1 an) avec renouvellement forcé."),
    ("Sessions à durée limitée", "Jetons JWT (JSON Web Token) expirant après 24 heures — reconnexion obligatoire."),
    ("Réinitialisation sécurisée", "Code à usage unique envoyé par courriel, valide 15 minutes, maximum 5 tentatives, haché en base."),
    ("Alertes de connexion suspecte", "Courriel automatique lors d'une connexion depuis une nouvelle adresse IP "
     "(Internet Protocol — l'adresse réseau de l'appareil)."),
    ("Borne de pointage protégée", "NIP (numéro d'identification personnel) à 4 chiffres haché avec SHA-256 "
     "(Secure Hash Algorithm — algorithme de hachage sécurisé) et un poivre secret ; verrouillage temporaire après "
     "plusieurs NIP invalides (anti-force brute)."),
])

# 3. Chiffrement
section(3, "Chiffrement des données")
bullets([
    "<b>En transit :</b> toutes les communications passent par HTTPS/TLS (Transport Layer Security — "
    "protocole de chiffrement des communications entre le navigateur et le serveur).",
    "<b>Au repos :</b> les documents sensibles (certificats de licences professionnelles de l'OPQ — Ordre des "
    "pharmaciens du Québec) sont chiffrés avec une clé Fernet basée sur AES (Advanced Encryption Standard — "
    "norme de chiffrement avancé) avant stockage — un accès direct aux fichiers ne révèle rien.",
    "<b>Secrets MFA :</b> chiffrés avec la même infrastructure de clés.",
    "<b>Clés et identifiants :</b> aucun secret n'est inscrit dans le code source ; tout est stocké dans des "
    "variables d'environnement sur le serveur uniquement.",
])

# 4. Accès
section(4, "Contrôle d'accès")
bullets([
    "<b>Rôles hiérarchiques :</b> superadmin, administrateur, gestionnaire, employé — chacun ne voit que ce qui le concerne.",
    "<b>Accès par module personnalisable :</b> l'administrateur contrôle précisément quels modules chaque rôle "
    "(ou chaque personne) peut consulter.",
    "<b>Champs sensibles filtrés :</b> taux horaires, NIP et données RH ne sont jamais renvoyés aux employés non autorisés.",
])

# 5. GitHub
section(5, "GitHub — sauvegarde et intégrité du code")
story.append(Paragraph("<b>Important : GitHub n'héberge que le code source, jamais les données personnelles.</b> "
                       "Le code ne contient aucun renseignement personnel ni aucun secret.", s_body))
story.append(Spacer(1, 4))
bullets([
    "<b>Dépôt privé :</b> code visible uniquement par les collaborateurs autorisés.",
    "<b>Historique complet et inaltérable :</b> chaque modification du code est tracée (qui, quand, quoi) — "
    "retour possible à toute version antérieure.",
    "<b>Chiffrement</b> au repos et en transit ; détection automatique de secrets accidentellement exposés.",
    "<b>Standard de l'industrie :</b> utilisé par les institutions financières, gouvernements et systèmes de santé "
    "(propriété de Microsoft).",
    "<b>Continuité d'affaires :</b> en cas de panne de l'hébergeur, l'application peut être redéployée ailleurs "
    "en quelques heures à partir du dépôt.",
])

# 6. Hébergement
section(6, "Hébergement des données")
bullets([
    "<b>Situation actuelle :</b> les données sont hébergées sur l'infrastructure infonuagique Google Cloud, "
    "région us-central1 (Iowa, États-Unis) : conteneurs isolés, HTTPS, base de données dédiée, chiffrement au "
    "repos et en transit, sauvegardes horaires et quotidiennes.",
    "<b>Ce que la Loi 25 exige (article 17) :</b> les renseignements personnels peuvent être hébergés hors Québec "
    "à condition qu'une évaluation des facteurs relatifs à la vie privée (ÉFVP) démontre une protection adéquate. "
    "Cette ÉFVP a été réalisée et documentée ; l'hébergement hors Québec est divulgué dans la politique de confidentialité.",
])
story.append(Spacer(1, 4))
story.append(Paragraph("Option renforcée planifiée — hébergement 100 % québécois", s_h2))
bullets([
    "OVHcloud (Beauharnois), AWS ou Google Cloud (région Montréal) avec MongoDB Atlas région Montréal.",
    "Avantage : les données ne quitteraient plus le Québec → aucune ÉFVP de transfert requise, conformité simplifiée, "
    "argument de confiance pour les pharmacies clientes.",
    "Sauvegardes automatiques, authentification obligatoire et chiffrement géré inclus avec MongoDB Atlas.",
])

# 7. Complémentaires
section(7, "Mesures complémentaires")
bullets([
    "<b>Signatures électroniques</b> conservées avec horodatage au dossier de l'employé.",
    "<b>Suivi des licences professionnelles</b> (OPQ) avec certificats chiffrés et alertes d'expiration.",
    "<b>Séparation des environnements :</b> développement distinct de la production — aucun test sur les données réelles.",
    "<b>Gestion des départs :</b> suspension immédiate du compte et anonymisation possible à la fin de l'emploi.",
])

# 8. Tests de sécurité effectués
section(8, "Tests de durcissement de la base de données — résultats")
story.append(Paragraph(
    "Tests exécutés le 19 août 2026 selon la liste de vérification de durcissement MongoDB "
    "(pare-feu, liaison d'adresses IP, authentification, balayage externe).", s_body))
story.append(Spacer(1, 6))
test_rows = [
    [Paragraph("<b>Test</b>", s_cell_k), Paragraph("<b>Méthode</b>", s_cell_k), Paragraph("<b>Résultat</b>", s_cell_k)],
    [Paragraph("Balayage externe des ports base de données (« test ultime »)", s_cell_v),
     Paragraph("Tentatives de connexion TCP depuis l'extérieur du réseau vers les ports 27017, 27018 et 27019 "
               "de la production (arriereplanrh.com) et de l'environnement de développement.", s_cell_v),
     Paragraph("<b><font color='#065f46'>CONFORME</font></b> — Connexion refusée sur tous les ports base de données. "
               "Seul le port 443 (HTTPS) répond.", s_cell_v)],
    [Paragraph("Point d'entrée unique", s_cell_v),
     Paragraph("Vérification des ports exposés publiquement.", s_cell_v),
     Paragraph("<b><font color='#065f46'>CONFORME</font></b> — L'application n'est joignable que par HTTPS (443) ; "
               "la base de données n'a aucune adresse publique.", s_cell_v)],
    [Paragraph("Isolation réseau (équivalent pare-feu UFW)", s_cell_v),
     Paragraph("La base MongoDB vit dans un conteneur isolé (Kubernetes) : seul le serveur d'application du même "
               "conteneur peut lui parler.", s_cell_v),
     Paragraph("<b><font color='#065f46'>CONFORME</font></b> — Équivalent moderne de la règle "
               "« ALLOW FROM [IP application] » exigée sur un serveur autonome.", s_cell_v)],
    [Paragraph("Liaison d'adresses (bindIp)", s_cell_v),
     Paragraph("Inspection du fichier de configuration mongod.conf.", s_cell_v),
     Paragraph("<b><font color='#065f46'>VÉRIFIÉ</font></b> — bindIp : 127.0.0.1 (connexions locales seulement) "
               "dans la configuration ; l'exposition externe est bloquée au niveau réseau (confirmé par le balayage).", s_cell_v)],
    [Paragraph("Authentification MongoDB (authorization)", s_cell_v),
     Paragraph("Vérification de la configuration de sécurité du serveur de base de données.", s_cell_v),
     Paragraph("<b><font color='#b45309'>PLANIFIÉ</font></b> — Non requise dans l'environnement géré actuel "
               "(base inaccessible de l'extérieur : contrôle compensatoire). Sera imposée d'office lors de la "
               "migration vers MongoDB Atlas région Montréal (authentification + TLS + liste blanche d'IP obligatoires).", s_cell_v)],
]
tt = Table(test_rows, colWidths=[42 * mm, 62 * mm, doc.width - 104 * mm], hAlign="LEFT", repeatRows=1)
tt.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), EMERALD),
    ("TEXTCOLOR", (0, 0), (-1, 0), white),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, BG_CARD]),
    ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
story.append(tt)
story.append(Spacer(1, 4))
story.append(Paragraph(
    "<i>Conclusion des tests : le critère décisif — l'injoignabilité de la base de données depuis Internet — "
    "est démontré sur les deux environnements. Les recommandations propres aux serveurs autonomes (UFW, bindIp réseau privé) "
    "sont couvertes par des contrôles équivalents de l'infrastructure conteneurisée.</i>", s_body))

# 9. IA encadrée
section(9, "Encadrement de l'intelligence artificielle (IA)")
story.append(Paragraph(
    "Arrière Plan utilise l'IA pour générer les horaires, les formations et certaines analyses. "
    "Voici pourquoi cette IA ne peut pas prendre vos renseignements sensibles ni en faire un usage non autorisé :", s_body))
story.append(Spacer(1, 5))
bullets([
    "<b>Minimisation des données :</b> l'IA ne reçoit que le strict nécessaire à chaque tâche (noms, postes, "
    "disponibilités, budgets). Elle ne reçoit jamais de mots de passe, de NIP (numéros d'identification personnels), "
    "de documents signés ni de renseignements médicaux.",
    "<b>Aucun accès direct :</b> l'IA n'a aucun accès à la base de données. Elle reçoit une demande ponctuelle, "
    "renvoie une proposition, puis l'échange se termine — sans mémoire persistante de vos données.",
    "<b>Aucun entraînement sur vos données :</b> les modèles sont utilisés par API professionnelle "
    "(interface de programmation d'applications), dont les conditions d'utilisation excluent l'usage des données "
    "transmises pour entraîner les modèles.",
    "<b>Transit chiffré :</b> chaque échange avec les modèles d'IA passe par TLS (Transport Layer Security), "
    "comme le reste de l'application.",
    "<b>Un humain garde toujours le dernier mot :</b> aucune décision automatisée — chaque horaire, formation ou "
    "proposition générée par l'IA doit être revue et approuvée par un gestionnaire avant d'être appliquée "
    "(transparence exigée par la Loi 25 pour les traitements automatisés).",
    "<b>Garde-fous serveur :</b> chaque réponse de l'IA est validée par le serveur (employés existants, succursales "
    "permises, budgets, chevauchements) avant tout enregistrement — une réponse invalide est rejetée.",
])

# 10. Lexique
section(10, "Lexique des acronymes et termes techniques")
glossary_rows = [
    ("Loi 25", "Loi québécoise modernisant la protection des renseignements personnels dans le secteur privé."),
    ("MFA", "Multi-Factor Authentication — authentification multifacteur : un code en plus du mot de passe."),
    ("TOTP", "Time-based One-Time Password — mot de passe à usage unique basé sur le temps (ex. Google Authenticator)."),
    ("JWT", "JSON Web Token — jeton de session signé qui expire automatiquement (24 h ici)."),
    ("HTTPS / TLS", "Transport Layer Security — chiffrement de toutes les communications entre l'appareil et le serveur."),
    ("AES / Fernet", "Advanced Encryption Standard — norme de chiffrement utilisée pour protéger les fichiers sensibles."),
    ("SHA-256", "Secure Hash Algorithm — fonction de hachage : transforme une donnée en empreinte irréversible."),
    ("bcrypt", "Algorithme de hachage renforcé conçu spécifiquement pour protéger les mots de passe."),
    ("NIP", "Numéro d'identification personnel — le code à 4 chiffres de la borne de pointage."),
    ("OPQ", "Ordre des pharmaciens du Québec — ordre professionnel encadrant la pratique."),
    ("CAI", "Commission d'accès à l'information du Québec — organisme de surveillance de la Loi 25."),
    ("ÉFVP", "Évaluation des facteurs relatifs à la vie privée — analyse exigée avant un transfert de données hors Québec."),
    ("API", "Application Programming Interface — interface de programmation permettant à deux logiciels de communiquer."),
    ("IA", "Intelligence artificielle — ici, les modèles générant horaires et formations, toujours validés par un humain."),
    ("IP", "Internet Protocol — l'adresse réseau identifiant un appareil connecté."),
    ("TCP", "Transmission Control Protocol — protocole de connexion réseau utilisé pour les tests de balayage."),
    ("SIRH", "Système d'information de ressources humaines — la catégorie de logiciel d'Arrière Plan."),
    ("UFW", "Uncomplicated Firewall — pare-feu simplifié des serveurs Linux autonomes."),
]
card_table(glossary_rows, col1=34 * mm)

# 11. Résumé
section(11, "Résumé exécutif")
quote = Table([[Paragraph(
    "Arrière Plan applique le principe de protection dès la conception (<i>privacy by design</i>) : consentement "
    "explicite, chiffrement des données sensibles, authentification forte imposable, journal d'audit exhaustif, "
    "droit à l'oubli en un clic et cloisonnement strict par pharmacie. Le code source est sécurisé et versionné "
    "sur GitHub (sans aucune donnée personnelle), et l'architecture permet une migration vers un hébergement "
    "entièrement québécois pour une conformité Loi 25 maximale.", s_quote)]],
    colWidths=[doc.width])
quote.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), BG_SOFT),
    ("LINEBEFORE", (0, 0), (0, -1), 3, EMERALD),
    ("LEFTPADDING", (0, 0), (-1, -1), 12),
    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ("TOPPADDING", (0, 0), (-1, -1), 10),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
]))
story.append(KeepTogether(quote))

doc.build(story)
print("PDF généré :", OUT)
