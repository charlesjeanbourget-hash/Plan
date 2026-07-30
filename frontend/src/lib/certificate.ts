import { jsPDF } from 'jspdf';

export interface CertificateData {
  employeeName: string;
  trainingTitle: string;
  score: number;
  passingScore: number;
  date: string;
  pharmacyName?: string;
}

const slug = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const downloadCertificate = (d: CertificateData): void => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const cx = 148.5;

  doc.setFillColor(248, 250, 252);
  doc.rect(0, 0, 297, 210, 'F');
  doc.setDrawColor(5, 150, 105);
  doc.setLineWidth(1.5);
  doc.rect(10, 10, 277, 190);
  doc.setLineWidth(0.4);
  doc.setDrawColor(195, 96, 48);
  doc.rect(14, 14, 269, 182);

  doc.setTextColor(5, 150, 105);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('Arrière Plan', cx, 34, { align: 'center' });
  if (d.pharmacyName) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(d.pharmacyName, cx, 41, { align: 'center' });
  }

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.text('CERTIFICAT DE RÉUSSITE', cx, 62, { align: 'center' });
  doc.setDrawColor(195, 96, 48);
  doc.setLineWidth(0.8);
  doc.line(cx - 45, 68, cx + 45, 68);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(100, 116, 139);
  doc.text('Ce certificat est décerné à', cx, 84, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(15, 23, 42);
  doc.text(d.employeeName, cx, 98, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(100, 116, 139);
  doc.text('pour avoir complété avec succès la formation', cx, 112, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(5, 150, 105);
  const titleLines = doc.splitTextToSize(`« ${d.trainingTitle} »`, 230) as string[];
  doc.text(titleLines, cx, 124, { align: 'center' });
  const afterTitle = 124 + titleLines.length * 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(`Résultat obtenu : ${d.score} %  (note de passage : ${d.passingScore} %)`, cx, afterTitle + 8, { align: 'center' });

  doc.setFontSize(11);
  doc.setTextColor(100, 116, 139);
  doc.text(`Délivré le ${d.date}`, cx, afterTitle + 18, { align: 'center' });

  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.line(200, 178, 270, 178);
  doc.setFontSize(9);
  doc.text('Signature du gestionnaire', 235, 184, { align: 'center' });

  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('Certificat généré automatiquement par Arrière Plan — formation conforme aux procédures internes de la pharmacie.', cx, 195, { align: 'center' });

  doc.save(`certificat-${slug(d.trainingTitle)}-${slug(d.employeeName)}.pdf`);
};
