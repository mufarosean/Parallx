export interface CanvasDragSession {
  readonly sourcePageId: string;
  readonly from: number;
  readonly to: number;
  readonly nodes: any[];
  readonly startedAt: number;
}

export const CANVAS_BLOCK_DRAG_MIME = 'application/x-parallx-canvas-block-drag';

let activeSession: CanvasDragSession | null = null;

export function setActiveCanvasDragSession(session: CanvasDragSession): void {
  activeSession = session;
}

export function getActiveCanvasDragSession(): CanvasDragSession | null {
  return activeSession;
}

export function clearActiveCanvasDragSession(): void {
  activeSession = null;
}
