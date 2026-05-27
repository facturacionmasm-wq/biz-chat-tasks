import React from 'react';

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class GlobalErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[RYBIX] Error boundary caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = '/';
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--rx-bg, #080810)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: "'DM Sans', system-ui, sans-serif",
      }}>
        {/* Background orb */}
        <div style={{
          position: 'fixed', width: 400, height: 400, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,79,114,.06), transparent)',
          filter: 'blur(80px)', top: '10%', left: '30%',
          pointerEvents: 'none',
        }} />

        <div style={{
          width: '100%', maxWidth: 480, textAlign: 'center',
          position: 'relative', zIndex: 1,
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20, margin: '0 auto 24px',
            background: 'rgba(255,79,114,.12)',
            border: '1px solid rgba(255,79,114,.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32,
          }}>
            ⚠️
          </div>

          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(255,79,114,.1)', border: '1px solid rgba(255,79,114,.2)',
            borderRadius: 99, padding: '4px 14px', marginBottom: 18,
            fontSize: 10, fontWeight: 800, color: '#ff4f72',
            textTransform: 'uppercase', letterSpacing: '.1em',
          }}>
            Error inesperado
          </div>

          <h1 style={{
            fontFamily: "'Syne', system-ui, sans-serif",
            fontSize: 28, fontWeight: 800, letterSpacing: '-0.04em',
            color: 'var(--rx-t1, #eeeef8)', marginBottom: 12,
          }}>
            Algo salió mal
          </h1>

          <p style={{ fontSize: 14, color: 'var(--rx-t2, #8888aa)', marginBottom: 24, lineHeight: 1.6 }}>
            Ocurrió un error en la aplicación. Hemos registrado el problema.
            Puedes intentar recargar o volver al inicio.
          </p>

          {/* Error details (dev only) */}
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details style={{
              marginBottom: 24,
              background: 'rgba(255,79,114,.05)',
              border: '1px solid rgba(255,79,114,.15)',
              borderRadius: 12, padding: 16, textAlign: 'left',
            }}>
              <summary style={{ fontSize: 12, fontWeight: 600, color: '#ff4f72', cursor: 'pointer', marginBottom: 8 }}>
                Ver detalles del error
              </summary>
              <pre style={{
                fontSize: 11, color: 'var(--rx-t2, #8888aa)',
                fontFamily: 'JetBrains Mono, monospace',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                maxHeight: 200, overflow: 'auto',
              }}>
                {this.state.error.message}
                {'\n\n'}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: 'var(--rx-s2, #17172a)', border: '1px solid var(--rx-b1, rgba(255,255,255,.06))',
                borderRadius: 12, padding: '9px 20px',
                fontSize: 13, fontWeight: 650, color: 'var(--rx-t2, #8888aa)',
                cursor: 'pointer',
              }}
            >
              🔄 Recargar
            </button>
            <button
              onClick={this.handleReset}
              style={{
                background: 'var(--rx-brand, #00ffc6)', border: 'none',
                borderRadius: 12, padding: '9px 20px',
                fontSize: 13, fontWeight: 650, color: '#000',
                cursor: 'pointer',
                boxShadow: '0 0 16px rgba(0,255,198,.25)',
              }}
            >
              🏠 Ir al inicio
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default GlobalErrorBoundary;
