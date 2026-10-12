// pdfTypes.ts — what the PDF pane reads of a document: its outline and a selection's boxes.

export interface PdfOutlineItem {
  title: string;
  bold: boolean;
  italic: boolean;
  dest: string | any[] | null;
  url: string | null;
  items: PdfOutlineItem[];
}

export interface SelectionOverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
