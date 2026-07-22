// Fase 2 · PDF export — jsPDF + jspdf-autotable.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface PdfSection {
  title: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  summary?: Array<{ label: string; value: string }>;
}

export interface PdfMeta {
  tenantName: string;
  period: string;
  currency: string;
  generatedAt: Date;
  title: string;
}

export function renderFinancePdf(meta: PdfMeta, sections: PdfSection[]): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFillColor(30, 58, 138);
  doc.rect(0, 0, pageWidth, 60, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(meta.title, 40, 28);
  doc.setFontSize(9);
  doc.text(
    `${meta.tenantName}  ·  Periodo: ${meta.period}  ·  Moneda: ${meta.currency}`,
    40,
    46,
  );
  doc.text(
    `Generado: ${meta.generatedAt.toLocaleString('es-MX')}`,
    pageWidth - 40,
    46,
    { align: 'right' },
  );
  doc.setTextColor(30, 30, 30);

  let cursorY = 80;

  for (const section of sections) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(section.title, 40, cursorY);
    cursorY += 12;

    if (section.summary && section.summary.length > 0) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      for (const s of section.summary) {
        doc.text(`${s.label}: ${s.value}`, 40, cursorY);
        cursorY += 12;
      }
      cursorY += 4;
    }

    autoTable(doc, {
      head: [section.columns],
      body: section.rows,
      startY: cursorY,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      margin: { left: 40, right: 40 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cursorY = (doc as any).lastAutoTable.finalY + 24;
  }

  // Footer with pagination
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Página ${i} de ${pageCount}`,
      pageWidth - 40,
      doc.internal.pageSize.getHeight() - 20,
      { align: 'right' },
    );
    doc.text(
      meta.tenantName,
      40,
      doc.internal.pageSize.getHeight() - 20,
    );
  }

  return doc;
}

export function downloadPdf(filename: string, meta: PdfMeta, sections: PdfSection[]): void {
  const doc = renderFinancePdf(meta, sections);
  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}
