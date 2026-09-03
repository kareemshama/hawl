/**
 * PDF text extraction with pdf.js. Returns positioned text items for the statements package
 * and the flat text for summary extraction. Falls back to OCR when a page has no text layer.
 *
 * Note: tesseract.js downloads its language data from a CDN the first time OCR runs. That is
 * the one network call outside the price fetch, and only for scanned PDFs. Bundling the language
 * file locally is a follow-up.
 */
import * as pdfjsLib from "pdfjs-dist";
import type { PdfTextItem } from "@hawl/statements";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export interface PdfExtraction {
  items: PdfTextItem[];
  text: string;
  pages: number;
  method: "text" | "ocr" | "mixed";
}

export async function extractPdf(file: File, onProgress?: (msg: string) => void): Promise<PdfExtraction> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const items: PdfTextItem[] = [];
  const pageTexts: string[] = [];
  let ocrPages = 0;

  for (let p = 1; p <= pdf.numPages; p++) {
    onProgress?.(`Reading page ${p} of ${pdf.numPages}`);
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageItems: PdfTextItem[] = [];
    for (const it of content.items) {
      if (!("str" in it) || it.str.trim() === "") continue;
      const t = it.transform as number[];
      pageItems.push({ page: p, x: t[4] ?? 0, y: t[5] ?? 0, width: it.width ?? 0, str: it.str });
    }
    if (pageItems.length >= 5) {
      items.push(...pageItems);
      pageTexts.push(pageItems.map((i) => i.str).join(" "));
      continue;
    }
    // No text layer: OCR the rendered page.
    onProgress?.(`Page ${p} is scanned. Running OCR, this can take a minute.`);
    ocrPages++;
    const ocr = await ocrPage(page, p);
    items.push(...ocr.items);
    pageTexts.push(ocr.text);
  }

  return {
    items,
    text: pageTexts.join("\n\n"),
    pages: pdf.numPages,
    method: ocrPages === 0 ? "text" : ocrPages === pdf.numPages ? "ocr" : "mixed",
  };
}

async function ocrPage(page: pdfjsLib.PDFPageProxy, pageNumber: number): Promise<{ items: PdfTextItem[]; text: string }> {
  const scale = 2;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable for OCR");
  await page.render({ canvasContext: ctx, viewport }).promise;

  const { default: Tesseract } = await import("tesseract.js");
  const result = await Tesseract.recognize(canvas, "eng");
  canvas.remove();

  // Convert word boxes to the same coordinate system as pdf.js text items (origin bottom-left, PDF units).
  const items: PdfTextItem[] = [];
  const words = (result.data as unknown as { words?: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }).words ?? [];
  for (const w of words) {
    if (!w.text.trim()) continue;
    items.push({
      page: pageNumber,
      x: w.bbox.x0 / scale,
      y: (viewport.height - w.bbox.y1) / scale,
      width: (w.bbox.x1 - w.bbox.x0) / scale,
      str: w.text,
    });
  }
  return { items, text: result.data.text };
}
