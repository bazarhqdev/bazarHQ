'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { DEMO_ACCOUNTS } from '@bazarhq/shared';
import { Button, IconButton, TextField, type TextFieldProps } from '@bazarhq/ui';

export function PasswordField(props: Omit<TextFieldProps, 'type' | 'suffix'>) {
  const [show, setShow] = useState(false);
  return (
    <TextField
      {...props}
      type={show ? 'text' : 'password'}
      suffix={
        <IconButton label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((s) => !s)} className="size-8">
          {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </IconButton>
      }
    />
  );
}

export function GoogleButton({ onClick, loading, label = 'Continue with Google' }: { onClick: () => void; loading?: boolean; label?: string }) {
  return (
    <Button variant="secondary" block size="lg" onClick={onClick} loading={loading} icon={<GoogleGlyph />}>
      {label}
    </Button>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h6a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.8 3.3-8Z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2.1v2.8A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.7 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.6-2.8Z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.1 7.1l3.6 2.8C6.6 7.3 9.1 5.4 12 5.4Z" />
    </svg>
  );
}

export function Divider({ label = 'or' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle" role="separator">
      <span className="h-px flex-1 bg-line-strong" />
      {label}
      <span className="h-px flex-1 bg-line-strong" />
    </div>
  );
}

export function DemoAccounts({ onPick }: { onPick: (email: string, password: string) => void }) {
  return (
    <details className="mt-6 rounded-xl border border-dashed border-line-strong bg-white px-4 py-3 text-sm">
      <summary className="cursor-pointer font-semibold text-ink">Demo accounts (mock data)</summary>
      <ul className="mt-2 space-y-1.5">
        {DEMO_ACCOUNTS.filter((a) => a.role !== 'super_admin').map((a) => (
          <li key={a.email}>
            <button type="button" onClick={() => onPick(a.email, a.password)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-canvas">
              <span className="block font-semibold text-navy-800">{a.email}</span>
              <span className="block text-[12px] text-ink-muted">
                {a.note} · password <code className="rounded bg-canvas px-1">{a.password}</code>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
