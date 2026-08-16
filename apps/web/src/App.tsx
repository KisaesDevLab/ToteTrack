import { useQueryClient } from '@tanstack/react-query';
import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { onUnauthorized } from '@/api/client';
import { keys, useAuthStatus } from '@/api/hooks';
import { AppShell } from '@/components/AppShell';
import { EmptyState, ErrorNote, Spinner } from '@/components/ui';
import { LoginPage, SetupPage } from '@/pages/AuthPages';
import { BoxDetailPage } from '@/pages/BoxDetailPage';
import { BoxNewPage } from '@/pages/BoxNewPage';
import { BoxesPage } from '@/pages/BoxesPage';
import { HomePage } from '@/pages/HomePage';
import { LabelResolvePage } from '@/pages/LabelResolvePage';
import { LabelsPage } from '@/pages/LabelsPage';
import { ScanPage } from '@/pages/ScanPage';
import { LocationsPage } from '@/pages/LocationsPage';
import { SettingsPage } from '@/pages/SettingsPage';

export function App() {
  const auth = useAuthStatus();
  const qc = useQueryClient();
  const location = useLocation();

  // Any 401 from the API flips us back to the login screen.
  useEffect(
    () =>
      onUnauthorized(() =>
        qc.setQueryData(keys.auth, { setupRequired: false, authenticated: false }),
      ),
    [qc],
  );

  if (auth.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center text-ink-mute">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }
  if (auth.isError) {
    return (
      <div className="mx-auto max-w-sm p-6">
        <ErrorNote message="Cannot reach the ToteTrack server." retry={() => void auth.refetch()} />
      </div>
    );
  }

  const here = `${location.pathname}${location.search}`;
  const returnTo =
    location.pathname === '/login' || location.pathname === '/setup'
      ? ''
      : `?returnTo=${encodeURIComponent(here)}`;

  if (auth.data.setupRequired) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to={`/setup${returnTo}`} replace />} />
      </Routes>
    );
  }
  if (!auth.data.authenticated) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to={`/login${returnTo}`} replace />} />
      </Routes>
    );
  }

  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="boxes" element={<BoxesPage />} />
          <Route path="boxes/new" element={<BoxNewPage />} />
          <Route path="boxes/:id" element={<BoxDetailPage />} />
          <Route path="b/:labelId" element={<LabelResolvePage />} />
          <Route path="locations" element={<LocationsPage />} />
          <Route path="labels" element={<LabelsPage />} />
          <Route path="scan" element={<ScanPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="login" element={<AfterAuthRedirect />} />
          <Route path="setup" element={<AfterAuthRedirect />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}

/** Once authenticated, /login and /setup bounce to the requested page (QR deep links) or home. */
function AfterAuthRedirect() {
  const location = useLocation();
  const rt = new URLSearchParams(location.search).get('returnTo');
  const target = rt && rt.startsWith('/') && !rt.startsWith('//') ? rt : '/';
  return <Navigate to={target} replace />;
}

function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      body="That link doesn't go anywhere in ToteTrack."
      action={
        <Link to="/" className="btn-primary">
          Go to search
        </Link>
      }
    />
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info);
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-md p-6">
          <EmptyState
            title="Something went wrong"
            body={this.state.error.message}
            action={
              <button className="btn-primary" onClick={() => window.location.assign('/')}>
                Reload
              </button>
            }
          />
        </div>
      );
    }
    return this.props.children;
  }
}
