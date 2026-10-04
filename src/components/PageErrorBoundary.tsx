import { Component, type ReactNode } from 'react';

export class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    // Keep personal content and SQL bindings out of logs.
    console.error('RUMO: falha ao renderizar página', error.name);
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="startup-state" role="alert">
          <h1>Não foi possível mostrar esta página.</h1>
          <p>Seus dados permanecem no banco local. Tente abrir novamente ou escolha outra seção.</p>
          <button className="primary-button" onClick={() => this.setState({ failed: false })}>
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
