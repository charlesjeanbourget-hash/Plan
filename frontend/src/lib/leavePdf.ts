import { jsPDF } from 'jspdf';
import { getLogoDataUrl } from '@/lib/logoData';

export interface LeavePdfBalance {
  type: string;
  alloc: number;
  carry: number;
  used: number;
  remaining: number;
}

export interface LeavePdfRequest {
  type: string;
  start: string;
  end: string;
  days: number;
  status: string;
}

const day = (n: number): string => n.toLocaleString('fr-CA', { maximumFractionDigits: 1 });

export const downloadLeaveSummary = async (
  employeeName: string,
  year: number,
  balances: LeavePdfBalance[],
  requests: LeavePdfRequest[],
  pharmacyName: string
): Promise<void> => {
  const doc = new jsPDF();
  try {
    const logo = await getLogoDataUrl();
    doc.addImage(logo, 'JPEG', 20, 5, 34, 18.5);
  } catch {
    doc.setTextColor(5, 150, 105);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Arrière Plan', 20, 16);
  }
  doc.setTextColor(5, 150, 105);
  doc.setFontSize(17);
  doc.setFont('helvetica', 'bold');
  doc.text('Relevé annuel de congés', 190, 17, { align: 'right' });
  doc.setFillColor(195, 96, 48);
  doc.rect(20, 26, 170, 1.2, 'F');

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(12);
  doc.text(employeeName, 20, 37);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`${pharmacyName} — Année ${year}`, 20, 43);
  doc.text(`Généré le ${new Date().toLocaleDateString('fr-CA')}`, 190, 43, { align: 'right' });

  let y = 56;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(5, 150, 105);
  doc.text('Soldes par type de congé', 20, y);
  y += 7;
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  const cols = [20, 70, 100, 130, 160];
  ['Type', 'Alloués', 'Reportés', 'Utilisés', 'Restants'].forEach((h, i) => doc.text(h, cols[i], y));
  y += 2;
  doc.setDrawColor(226, 232, 240);
  doc.line(20, y, 190, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  balances.forEach((b) => {
    doc.setFont('helvetica', 'bold');
    doc.text(b.type, cols[0], y);
    doc.setFont('helvetica', 'normal');
    doc.text(`${day(b.alloc)} j`, cols[1], y);
    doc.text(b.carry > 0 ? `+${day(b.carry)} j` : '—', cols[2], y);
    doc.text(`${day(b.used)} j`, cols[3], y);
    if (b.remaining < 0) doc.setTextColor(220, 38, 38);
    doc.text(`${day(b.remaining)} j`, cols[4], y);
    doc.setTextColor(30, 41, 59);
    y += 7;
  });

  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(5, 150, 105);
  doc.text(`Congés de l'année ${year}`, 20, y);
  y += 7;
  const sorted = [...requests].sort((a, b) => a.start.localeCompare(b.start));
  if (sorted.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text('Aucun congé enregistré cette année.', 20, y);
    y += 7;
  } else {
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    const rc = [20, 60, 105, 140, 165];
    ['Type', 'Du', 'Au', 'Jours', 'Statut'].forEach((h, i) => doc.text(h, rc[i], y));
    y += 2;
    doc.line(20, y, 190, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    sorted.forEach((r) => {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      doc.text(r.type, rc[0], y);
      doc.text(r.start, rc[1], y);
      doc.text(r.end, rc[2], y);
      doc.text(day(r.days), rc[3], y);
      if (r.status === 'Approuvée') doc.setTextColor(5, 150, 105);
      else if (r.status === 'Refusée') doc.setTextColor(220, 38, 38);
      else doc.setTextColor(180, 120, 40);
      doc.text(r.status, rc[4], y);
      doc.setTextColor(30, 41, 59);
      y += 6.5;
    });
  }

  y = Math.min(y + 10, 280);
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('Document généré par Arrière Plan. Conformément à la Loi 25, les motifs détaillés des congés ne figurent pas sur ce relevé.', 105, y, { align: 'center' });

  doc.save(`releve-conges-${year}-${employeeName.toLowerCase().replace(/\s+/g, '-')}.pdf`);
};
