import PDFDocument from 'pdfkit';
import { STANDARD_DISCLOSURE } from '@atlas/shared';

// PDF rendering for invoices, company summaries and backtest reports (EXP-01, BKT-13, BIL-03).
// The standard disclosure is printed on every page; warnings cannot be removed from exports.
// PDFKit's built-in Helvetica cannot draw the rupee sign, so amounts use "Rs." in PDFs.

export interface PdfBlock {
  kind: 'title' | 'subtitle' | 'text' | 'warning' | 'table' | 'footnote' | 'spacer' | 'watermark';
  text?: string;
  columns?: string[];
  rows?: (string | number)[][];
  widths?: number[];
}

export const pdfSafe = (s: string) => s.replace(/₹/g, 'Rs. ').replace(/[−–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/×/g, 'x').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/÷/g, '/').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');

export function renderPdf(blocks: PdfBlock[], opts: { footer?: string; disclosure?: boolean; watermark?: string } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: 'ATLAS', Producer: 'ATLAS' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const width = doc.page.width - 96;
    for (const b of blocks) {
      if (doc.y > doc.page.height - 140) doc.addPage();
      switch (b.kind) {
        case 'title':
          doc.font('Helvetica-Bold').fontSize(18).fillColor('#14243d').text(pdfSafe(b.text ?? ''), { width });
          doc.moveDown(0.4);
          break;
        case 'subtitle':
          doc.font('Helvetica-Bold').fontSize(12).fillColor('#162033').text(pdfSafe(b.text ?? ''), { width });
          doc.moveDown(0.2);
          break;
        case 'text':
          doc.font('Helvetica').fontSize(10).fillColor('#162033').text(pdfSafe(b.text ?? ''), { width });
          doc.moveDown(0.3);
          break;
        case 'footnote':
          doc.font('Helvetica').fontSize(8).fillColor('#5a6577').text(pdfSafe(b.text ?? ''), { width });
          doc.moveDown(0.2);
          break;
        case 'warning':
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#a2620f').text(`Warning: ${pdfSafe(b.text ?? '')}`, { width });
          doc.moveDown(0.3);
          break;
        case 'watermark':
          doc.font('Helvetica-Bold').fontSize(14).fillColor('#b3382c').text(pdfSafe(b.text ?? ''), { width });
          doc.moveDown(0.3);
          break;
        case 'spacer':
          doc.moveDown(0.6);
          break;
        case 'table': {
          const cols = b.columns ?? [];
          const widths = b.widths ?? cols.map(() => width / Math.max(1, cols.length));
          const drawRow = (cells: (string | number)[], bold: boolean) => {
            if (doc.y > doc.page.height - 120) doc.addPage();
            const y = doc.y;
            let x = 48;
            let h = 0;
            cells.forEach((c, i) => {
              doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#162033');
              const t = pdfSafe(String(c));
              doc.text(t, x + 2, y, { width: widths[i]! - 4, align: i === 0 ? 'left' : 'right' });
              h = Math.max(h, doc.heightOfString(t, { width: widths[i]! - 4 }));
              x += widths[i]!;
            });
            doc.y = y + h + 4;
            doc.moveTo(48, doc.y - 2).lineTo(48 + width, doc.y - 2).strokeColor('#dce1e9').lineWidth(0.5).stroke();
          };
          drawRow(cols, true);
          for (const r of b.rows ?? []) drawRow(r, false);
          doc.x = 48;
          doc.moveDown(0.4);
          break;
        }
      }
    }
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.height - 44;
      doc.page.margins.bottom = 0;
      if (opts.watermark) doc.font('Helvetica-Bold').fontSize(9).fillColor('#b3382c').text(pdfSafe(opts.watermark), 48, 24, { width, align: 'right' });
      if (opts.disclosure !== false) doc.font('Helvetica').fontSize(6.5).fillColor('#5a6577').text(pdfSafe(STANDARD_DISCLOSURE.text), 48, bottom - 26, { width });
      doc.font('Helvetica').fontSize(6.5).fillColor('#5a6577').text(pdfSafe(`${opts.footer ?? 'ATLAS'} · page ${i + 1} of ${range.count}`), 48, bottom, { width });
    }
    doc.end();
  });
}
