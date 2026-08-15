import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLogin, useSetup } from '@/api/hooks';
import { BoxIcon, Spinner } from '@/components/ui';
import { errorMessage } from '@/lib/toast';

function useReturnTo(): string {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const rt = params.get('returnTo') ?? (location.state as { returnTo?: string } | null)?.returnTo;
  return rt && rt.startsWith('/') && !rt.startsWith('//') ? rt : '/';
}

function AuthFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-10">
      <div className="mb-8 flex flex-col items-center text-center">
        <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-ink text-paper shadow-pop">
          <BoxIcon className="h-7 w-7" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-ink-mute">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function PinInput({
  value,
  onChange,
  autoFocus,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  label: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-soft">{label}</span>
      <input
        className="input text-center font-mono text-2xl tracking-[0.4em]"
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        minLength={4}
        maxLength={64}
        required
      />
    </label>
  );
}

export function LoginPage() {
  const [pin, setPin] = useState('');
  const login = useLogin();
  const navigate = useNavigate();
  const returnTo = useReturnTo();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate(pin, { onSuccess: () => navigate(returnTo, { replace: true }) });
  };

  return (
    <AuthFrame title="ToteTrack" subtitle="Enter the household PIN to continue.">
      <form onSubmit={submit} className="space-y-4">
        <PinInput label="PIN" value={pin} onChange={setPin} autoFocus />
        {login.isError && (
          <p className="text-center text-sm text-bad">{errorMessage(login.error)}</p>
        )}
        <button className="btn-primary w-full" disabled={login.isPending || pin.length < 4}>
          {login.isPending ? <Spinner className="h-4 w-4" /> : null} Unlock
        </button>
        {returnTo !== '/' && (
          <p className="text-center text-xs text-ink-mute">
            You'll be taken to {returnTo} after unlocking.
          </p>
        )}
      </form>
    </AuthFrame>
  );
}

export function SetupPage() {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const setup = useSetup();
  const navigate = useNavigate();
  const returnTo = useReturnTo();
  const mismatch = confirm.length > 0 && pin !== confirm;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pin !== confirm) return;
    setup.mutate(pin, { onSuccess: () => navigate(returnTo, { replace: true }) });
  };

  return (
    <AuthFrame
      title="Welcome to ToteTrack"
      subtitle="Set a shared PIN for your household. You can change it later in Settings."
    >
      <form onSubmit={submit} className="space-y-4">
        <PinInput label="Choose a PIN (4+ characters)" value={pin} onChange={setPin} autoFocus />
        <PinInput label="Confirm PIN" value={confirm} onChange={setConfirm} />
        {mismatch && <p className="text-center text-sm text-bad">PINs don't match</p>}
        {setup.isError && (
          <p className="text-center text-sm text-bad">{errorMessage(setup.error)}</p>
        )}
        <button
          className="btn-primary w-full"
          disabled={setup.isPending || pin.length < 4 || pin !== confirm}
        >
          {setup.isPending ? <Spinner className="h-4 w-4" /> : null} Set PIN & continue
        </button>
      </form>
    </AuthFrame>
  );
}
