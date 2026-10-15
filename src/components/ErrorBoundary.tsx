import { Component, type ReactNode } from 'react';

/** Instead of a blank screen: show what went wrong and offer a clean reload. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  private async hardReload() {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations();
      await Promise.all((regs ?? []).map((r) => r.unregister()));
      const keys = await caches?.keys();
      await Promise.all((keys ?? []).map((k) => caches.delete(k)));
    } catch {
      /* best effort */
    }
    location.reload();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>Etwas ist schiefgelaufen</h1>
        <p>Deine Sammlung ist sicher gespeichert. Lade die App neu.</p>
        <code>{this.state.error.message}</code>
        <button className="primary-btn" onClick={() => location.reload()}>
          Neu laden
        </button>
        <button className="link-btn" onClick={() => this.hardReload()}>
          App-Zwischenspeicher leeren & neu laden
        </button>
      </div>
    );
  }
}
