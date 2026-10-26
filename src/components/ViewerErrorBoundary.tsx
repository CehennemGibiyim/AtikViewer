"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  resetKey: string;
  label?: string;
  onClose?: () => void;
}

/** Tek bir görüntüleyici hatası, dosya açma ve menü düğmelerini durdurmasın. */
export default class ViewerErrorBoundary extends Component<Props, { error: string | null }> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message || "Beklenmeyen görüntüleme hatası" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Görüntüleyici paneli hatası", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex h-full min-h-40 flex-col items-center justify-center gap-3 bg-[#0b1018] p-5 text-center">
        <span className="text-sm font-bold text-amber-200">{this.props.label ?? "Görüntüleyici"} açılamadı</span>
        <p className="max-w-md text-xs leading-relaxed text-slate-400">{this.state.error}</p>
        <p className="text-xs text-slate-500">Menüler çalışmaya devam ediyor. Başka bir seri açabilir veya tekrar deneyebilirsiniz.</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => this.setState({ error: null })} className="rounded border border-cyan-400/40 px-3 py-2 text-xs font-semibold text-cyan-300">Tekrar dene</button>
          {this.props.onClose && <button type="button" onClick={this.props.onClose} className="rounded border border-slate-600 px-3 py-2 text-xs text-slate-300">Kapat</button>}
        </div>
      </div>
    );
  }
}
