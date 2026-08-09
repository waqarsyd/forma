import {StrictMode, Component, ErrorInfo, ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {MotionConfig} from 'motion/react';
import App from './App.tsx';
import './index.css';

class ErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6">
          <div className="bg-card border border-border rounded-xl shadow-lg p-8 max-w-xl w-full text-center">
            <h1 className="text-2xl font-bold text-error mb-4">Something went wrong.</h1>
            <p className="text-muted-foreground mb-6">An unexpected error occurred in the application view.</p>
            <div className="bg-muted p-4 rounded-lg text-left overflow-auto text-xs font-mono max-h-40">
               {this.state.error?.message || "Unknown error"}
            </div>
            <button 
              onClick={() => window.location.reload()} 
              className="mt-6 px-6 py-2 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// reducedMotion="user" makes every Framer animation in the app honour the OS
// preference: transform and layout animations are dropped, opacity is kept, so
// content still arrives without sliding. The CSS media query in index.css only
// reaches CSS transitions — Framer drives inline styles and needs this. It also
// covers ContactPage and DocsPage, which never called useReducedMotion at all.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </MotionConfig>
  </StrictMode>,
);
