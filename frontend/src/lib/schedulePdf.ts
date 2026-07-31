import { jsPDF } from 'jspdf';
import { Employee, Shift } from '@/types';
import { getLogoDataUrl } from '@/lib/logoData';
import { hoursBetween } from '@/lib/schedule';

const dayLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });

export const downloadSchedulePdf = async (
  days: string[],
  shifts: Shift[],
  employees: Employee[],
  pharmacyName: string,
): Promise<void> => {
  const weekShifts = shifts.filter((s) => s.date >= days[0] && s.date <= days[6]);
  const emps = employees
    .filter((e) => weekShifts.some((s) => s.employeeId === e.id))
    .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));

  const doc = new jsPDF({ orientation: 'landscape' });
  try {
    const logoData = await getLogoDataUrl();
    doc.addImage(logoData, 'JPEG', 14, 4, 28, 15.3);
  } catch {
    doc.setTextColor(5, 150, 105);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Arrière Plan', 14, 13);
  }
  doc.setTextColor(5, 150, 105);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Horaire de la semaine', 283, 13, { align: 'right' });
  doc.setFillColor(195, 96, 48);
  doc.rect(0, 22, 297, 1, 'F');

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(pharmacyName, 14, 30);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Semaine du ${days[0]} au ${days[6]}  ·  Généré le ${new Date().toLocaleDateString('fr-CA')}`, 283, 30, { align: 'right' });

  const x0 = 14;
  const nameW = 52;
  const colW = (283 - x0 - nameW) / 7;
  let y = 36;

  doc.setFillColor(5, 150, 105);
  doc.rect(x0, y, nameW + colW * 7, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('Employé(e)', x0 + 2, y + 5.4);
  days.forEach((d, i) => {
    doc.text(dayLabel(d), x0 + nameW + colW * i + colW / 2, y + 5.4, { align: 'center' });
  });
  y += 8;

  emps.forEach((emp, idx) => {
    const byDay = days.map((d) => weekShifts
      .filter((s) => s.employeeId === emp.id && s.date === d)
      .sort((a, b) => a.startTime.localeCompare(b.startTime)));
    const maxShifts = Math.max(1, ...byDay.map((l) => l.length));
    const rowH = Math.max(11, maxShifts * 5 + 6);
    if (y + rowH > 200) {
      doc.addPage('a4', 'landscape');
      y = 14;
    }
    if (idx % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(x0, y, nameW + colW * 7, rowH, 'F');
    }
    doc.setDrawColor(226, 232, 240);
    doc.rect(x0, y, nameW, rowH);
    const totalHours = byDay.flat().reduce((sum, s) => sum + hoursBetween(s.startTime, s.endTime), 0);
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.text(`${emp.firstName} ${emp.lastName}`, x0 + 2, y + 5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`${emp.position} · ${totalHours.toLocaleString('fr-CA')} h`, x0 + 2, y + 9);
    byDay.forEach((list, i) => {
      const cx = x0 + nameW + colW * i;
      doc.setDrawColor(226, 232, 240);
      doc.rect(cx, y, colW, rowH);
      doc.setFontSize(8);
      list.forEach((s, j) => {
        doc.setTextColor(5, 150, 105);
        doc.setFont('helvetica', 'bold');
        doc.text(`${s.startTime}–${s.endTime}`, cx + colW / 2, y + 5.5 + j * 5, { align: 'center' });
      });
    });
    y += rowH;
  });

  if (emps.length === 0) {
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(10);
    doc.text('Aucun quart planifié cette semaine.', x0, y + 10);
  }

  doc.setTextColor(148, 163, 184);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.text('Document généré par Arrière Plan — à afficher dans la salle du personnel.', x0, 205);

  doc.save(`horaire_semaine_${days[0]}.pdf`);
};
