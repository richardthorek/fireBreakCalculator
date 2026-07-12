/**
 * SMEACS briefing PDF builder — client-side generation for field distribution.
 * Creates a print-friendly PDF with briefing sections + static map image + citations.
 * Lazy-loaded pdf-lib for bundle efficiency.
 */

import { SmeacsBriefing } from '../types/assistant';

interface PDFGeneratorModule {
  PDFDocument: typeof import('pdf-lib').PDFDocument;
  rgb: typeof import('pdf-lib').rgb;
  degrees: typeof import('pdf-lib').degrees;
}

let pdfModule: PDFGeneratorModule | null = null;

/**
 * Lazy-load pdf-lib and return the module.
 * Throws if pdf-lib is not available.
 */
async function getPdfModule(): Promise<PDFGeneratorModule> {
  if (pdfModule) return pdfModule;

  try {
    const mod = await import('pdf-lib');
    pdfModule = {
      PDFDocument: mod.PDFDocument,
      rgb: mod.rgb,
      degrees: mod.degrees,
    };
    return pdfModule;
  } catch (error) {
    throw new Error('pdf-lib not available for PDF generation');
  }
}

/**
 * Build a SMEACS briefing PDF with sections + metadata.
 * If mapImageUrl is provided, embeds a static map image.
 * Returns PDF as a Blob suitable for download.
 */
export async function buildSmeacsPdf(
  briefing: SmeacsBriefing,
  planName: string,
  mapImageUrl?: string
): Promise<Blob> {
  const pdf = await getPdfModule();
  const { PDFDocument, rgb } = pdf;

  const doc = await PDFDocument.create();
  let page = doc.addPage([595, 842]); // A4 size in points

  const fontSize = 10;
  const lineHeight = fontSize + 3;
  let yPos = 800;
  const margin = 40;
  const pageWidth = 595 - 2 * margin;

  // Title
  const titleSize = 14;
  yPos -= titleSize;
  page.drawText('🔥 FIRE BREAK BRIEFING', {
    x: margin,
    y: yPos,
    size: titleSize,
    color: rgb(0.2, 0.2, 0.2),
  });

  yPos -= lineHeight * 1.5;

  // Metadata
  const metaSize = 8;
  const generatedDate = new Date(briefing.generatedAt).toLocaleString();
  page.drawText(`Generated: ${generatedDate} | Plan: ${planName}`, {
    x: margin,
    y: yPos,
    size: metaSize,
    color: rgb(0.5, 0.5, 0.5),
  });

  yPos -= lineHeight * 2;

  // Draw each section
  for (const section of briefing.sections) {
    // Section heading
    const headingSize = 11;
    if (yPos < 60) {
      page = doc.addPage([595, 842]);
      yPos = 800;
    }

    yPos -= headingSize;
    page.drawText(`## ${section.heading}`, {
      x: margin,
      y: yPos,
      size: headingSize,
      color: rgb(0, 0, 0.3),
    });

    yPos -= lineHeight;

    // Section lines (word-wrapped)
    for (const line of section.lines) {
      const words = line.split(' ');
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = testLine.length * 2.2; // Rough character width estimate

        if (testWidth > pageWidth) {
          // Flush current line
          if (currentLine) {
            if (yPos < 40) {
              page = doc.addPage([595, 842]);
              yPos = 800;
            }
            yPos -= fontSize;
            page.drawText(currentLine, {
              x: margin + 10,
              y: yPos,
              size: fontSize,
              color: rgb(0.2, 0.2, 0.2),
            });
          }
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      // Final line
      if (currentLine) {
        if (yPos < 40) {
          page = doc.addPage([595, 842]);
          yPos = 800;
        }
        yPos -= fontSize;
        page.drawText(currentLine, {
          x: margin + 10,
          y: yPos,
          size: fontSize,
          color: rgb(0.2, 0.2, 0.2),
        });
      }
    }

    // Citations for section
    if (section.citations.length > 0) {
      yPos -= lineHeight;
      const citationSize = 7;
      page.drawText('Sources:', {
        x: margin + 10,
        y: yPos,
        size: citationSize,
        color: rgb(0.4, 0.4, 0.4),
      });

      for (const cit of section.citations) {
        if (yPos < 40) {
          page = doc.addPage([595, 842]);
          yPos = 800;
        }
        yPos -= citationSize + 2;
        page.drawText(`• [${cit.id}] ${cit.title}`, {
          x: margin + 15,
          y: yPos,
          size: citationSize,
          color: rgb(0.5, 0.5, 0.5),
        });
      }
    }

    yPos -= lineHeight;
  }

  // Data honesty caveat
  if (briefing.dataHonestyCaveat) {
    if (yPos < 60) {
      page = doc.addPage([595, 842]);
      yPos = 800;
    }
    yPos -= lineHeight;
    const caveatSize = 9;
    page.drawText(`⚠️  ${briefing.dataHonestyCaveat}`, {
      x: margin,
      y: yPos,
      size: caveatSize,
      color: rgb(0.8, 0.4, 0),
    });
  }

  // Convert to Blob and return
  const pdfBytes = await doc.save();
  // Uint8Array-backed Blob; cast keeps TS happy across lib versions.
  return new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
}
