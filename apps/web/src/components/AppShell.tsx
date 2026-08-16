import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BoxIcon } from './ui';

const tabs = [
  { to: '/', label: 'Search', icon: SearchIcon, end: true },
  { to: '/boxes', label: 'Boxes', icon: BoxIcon },
  { to: '/boxes/new', label: 'Add', icon: PlusIcon, primary: true },
  { to: '/locations', label: 'Places', icon: PinIcon },
  { to: '/settings', label: 'Settings', icon: GearIcon },
] as const;

export function AppShell() {
  const location = useLocation();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur supports-[backdrop-filter]:bg-paper/75">
        <div className="flex h-12 items-center justify-between px-4">
          <NavLink to="/" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-ink text-paper">
              <BoxIcon className="h-4 w-4" />
            </span>
            ToteTrack
          </NavLink>
          <div className="flex items-center gap-1">
            <NavLink to="/scan" className="btn-accent btn-sm text-xs" title="Scan a tote label">
              <CameraIcon className="h-4 w-4" /> Scan
            </NavLink>
            <NavLink to="/labels" className="btn-ghost btn-sm text-xs">
              <PrintIcon className="h-4 w-4" /> Labels
            </NavLink>
          </div>
        </div>
      </header>

      <main key={location.pathname} className="flex-1 px-4 pb-24 pt-4">
        <Outlet />
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper-raised/95 backdrop-blur safe-bottom"
        aria-label="Primary"
      >
        <div className="mx-auto grid max-w-3xl grid-cols-5">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={'end' in t ? t.end : false}
              className={({ isActive }) =>
                `flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                  'primary' in t && t.primary
                    ? 'text-accent-deep'
                    : isActive
                      ? 'text-ink'
                      : 'text-ink-mute'
                }`
              }
            >
              {({ isActive }) =>
                'primary' in t && t.primary ? (
                  <>
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-accent text-white shadow-pop">
                      <t.icon className="h-5 w-5" />
                    </span>
                    <span className="sr-only">{t.label}</span>
                  </>
                ) : (
                  <>
                    <t.icon className={`h-5 w-5 ${isActive ? 'text-accent' : ''}`} />
                    {t.label}
                  </>
                )
              }
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function SearchIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}
export function PlusIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
export function PinIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21s-6-5.3-6-11a6 6 0 1112 0c0 5.7-6 11-6 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
export function GearIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  );
}
export function PrintIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9V3h12v6M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
      <path d="M6 14h12v7H6z" />
    </svg>
  );
}
export function CameraIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
export function ChevronLeft({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}
export function TrashIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}
export function SparkIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2zM5 16l.9 2.1L8 19l-2.1.9L5 22l-.9-2.1L2 19l2.1-.9L5 16zM19 14l.7 1.6 1.6.7-1.6.7L19 18.6l-.7-1.6-1.6-.7 1.6-.7L19 14z" />
    </svg>
  );
}
