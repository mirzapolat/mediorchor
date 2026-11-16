// Connects the score's zoom (PdfScoreView) with a control elsewhere on the
// page (the round zoom button above the score): the view reports its zoom
// here and registers how to animate to another one.
export class ZoomBridge {
  private state = { zoom: 1, ready: false };
  private listeners = new Set<() => void>();
  private zoomTo: ((zoom: number) => void) | null = null;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  get = () => this.state;

  // From the view.
  report(zoom: number) {
    if (this.state.ready && Math.abs(this.state.zoom - zoom) < 0.005) return;
    this.state = { zoom, ready: true };
    for (const fn of this.listeners) fn();
  }

  register(zoomTo: ((zoom: number) => void) | null) {
    this.zoomTo = zoomTo;
    if (!zoomTo && this.state.ready) {
      this.state = { ...this.state, ready: false };
      for (const fn of this.listeners) fn();
    }
  }

  // From the control.
  set(zoom: number) {
    this.zoomTo?.(zoom);
  }
}
