'use client';

import { useState } from 'react';
import { KeyRound, Lock, ShieldCheck } from 'lucide-react';
import {
  credentialSchemas,
  errorMessage,
  formatRelative,
  isServiceError,
  PAYMENT_METHOD_DESCRIPTION,
  PAYMENT_METHOD_LABEL,
  toFieldErrors,
  type FieldErrors,
  type PaymentConfig,
  type PaymentCredentials,
  type PaymentMethod,
} from '@bazarhq/shared';
import { useServices } from '../context';
import { Modal, useToast } from '../components';
import { Alert, Badge, Button, Card, Switch, TextField } from '../components';
import { PaymentMethodMark } from '../components';

type CredentialMethod = Exclude<PaymentMethod, 'cod'>;

const FIELDS: Record<CredentialMethod, { key: string; label: string; secret?: boolean; hint?: string; inputMode?: 'numeric' | 'text' }[]> = {
  bkash: [
    { key: 'merchantNumber', label: 'Merchant wallet number', hint: '11-digit bKash merchant number', inputMode: 'numeric' },
    { key: 'appKey', label: 'App key', secret: true },
    { key: 'appSecret', label: 'App secret', secret: true },
    { key: 'username', label: 'API username' },
    { key: 'password', label: 'API password', secret: true },
  ],
  nagad: [
    { key: 'merchantId', label: 'Merchant ID', inputMode: 'numeric' },
    { key: 'merchantNumber', label: 'Merchant wallet number', inputMode: 'numeric' },
    { key: 'publicKey', label: 'Public key', secret: true },
    { key: 'privateKey', label: 'Private key', secret: true },
  ],
  rocket: [
    { key: 'merchantNumber', label: 'Merchant number', inputMode: 'numeric' },
    { key: 'billerId', label: 'Biller ID' },
    { key: 'apiKey', label: 'API key', secret: true },
  ],
  sslcommerz: [
    { key: 'storeId', label: 'Store ID' },
    { key: 'storePassword', label: 'Store password', secret: true },
  ],
};

const validationBadge = (c: PaymentConfig) => {
  if (c.method === 'cod') return <Badge tone="neutral">No credentials needed</Badge>;
  if (c.validation === 'invalid') return <Badge tone="danger">Verification failed</Badge>;
  if (c.validation === 'valid') return <Badge tone="success">Verified · {c.credentialHint}</Badge>;
  if (c.hasCredentials) return <Badge tone="warning">Credentials saved · verification pending</Badge>;
  return <Badge tone="neutral">Not configured</Badge>;
};

export function PaymentMethodCard({ config, onChange }: { config: PaymentConfig; onChange: (c: PaymentConfig) => void }) {
  const services = useServices();
  const toast = useToast();
  const [toggling, setToggling] = useState(false);
  const [open, setOpen] = useState(false);
  const label = PAYMENT_METHOD_LABEL[config.method];

  const toggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      const c = await services.payments.setEnabled(config.method, enabled);
      onChange(c);
      toast.success(`${label} ${enabled ? 'enabled' : 'disabled'}`, 'Applies to new orders only.');
    } catch (e) {
      toast.error(`Couldn’t update ${label}`, errorMessage(e));
    } finally {
      setToggling(false);
    }
  };

  return (
    <Card as="article" className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <PaymentMethodMark method={config.method} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-bold text-ink">{label}</h3>
            {config.method !== 'cod' && <Badge tone={config.environment === 'live' ? 'success' : 'info'}>{config.environment === 'live' ? 'Live' : 'Sandbox'}</Badge>}
          </div>
          <p className="mt-0.5 text-[13px] text-ink-muted">{PAYMENT_METHOD_DESCRIPTION[config.method]}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {validationBadge(config)}
            {config.updatedAt ? (
              <span className="text-[12px] text-ink-subtle">Updated {formatRelative(config.updatedAt)}</span>
            ) : config.method === 'cod' ? (
              <span className="text-[12px] text-ink-subtle">No credentials needed</span>
            ) : (
              <span className="text-[12px] text-ink-subtle">Not configured</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Switch
            checked={config.isEnabled}
            onChange={(v) => void toggle(v)}
            disabled={toggling || (config.method !== 'cod' && (!config.hasCredentials || config.validation === 'invalid'))}
            label={`Accept ${label}`}
          />
          <span className="text-[12px] font-semibold text-ink-muted">{config.isEnabled ? 'On' : 'Off'}</span>
        </div>
      </div>
      {config.method !== 'cod' && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <p className="flex items-center gap-1.5 text-[12.5px] text-ink-muted">
            <Lock className="size-3.5" aria-hidden /> Credentials are encrypted on the server and never shown again.
          </p>
          <Button size="sm" variant="secondary" icon={<KeyRound className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
            {config.hasCredentials ? 'Replace credentials' : 'Add credentials'}
          </Button>
        </div>
      )}
      {config.method !== 'cod' && (
        <CredentialsModal
          method={config.method}
          open={open}
          onClose={() => setOpen(false)}
          onSaved={(c) => {
            onChange(c);
            if (c.validation === 'invalid') {
              toast.error(`${label} turned off`, 'We couldn’t verify these credentials. Check them and try again.');
            } else if (c.validation === 'valid') {
              toast.success(`${label} credentials verified`, 'You can now enable this method.');
            } else {
              toast.success(`${label} credentials saved`, 'Provider verification is pending. Enable this method only after completing the provider’s sandbox setup.');
            }
          }}
        />
      )}
    </Card>
  );
}

function CredentialsModal({
  method,
  open,
  onClose,
  onSaved,
}: {
  method: CredentialMethod;
  open: boolean;
  onClose: () => void;
  onSaved: (c: PaymentConfig) => void;
}) {
  const services = useServices();
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Secrets live only in this component's state and are cleared on close/submit.
  const close = () => {
    setValues({});
    setErrors({});
    setError(null);
    onClose();
  };

  const submit = async () => {
    const res = credentialSchemas[method].safeParse(values);
    if (!res.success) {
      setErrors(toFieldErrors(res.error));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const c = await services.payments.saveCredentials({ method, values: res.data } as PaymentCredentials);
      onSaved(c);
      close();
    } catch (e) {
      if (isServiceError(e) && e.fieldErrors) setErrors(e.fieldErrors);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setValues((v) => Object.fromEntries(Object.keys(v).map((k) => [k, ''])));
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      busy={busy}
      title={`${PAYMENT_METHOD_LABEL[method]} sandbox credentials`}
      description="Use test credentials issued by the provider for academic testing. Sandbox transactions do not move real money. Live payments stay locked until the provider approves your merchant account."
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="brand" loading={busy} icon={<ShieldCheck className="size-4" aria-hidden />} onClick={() => void submit()}>
            Verify & save
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-canvas p-1 text-[13px] font-semibold" role="radiogroup" aria-label="Environment">
          <span role="radio" aria-checked="true" className="rounded-md bg-white py-1.5 text-center text-ink shadow-sm">
            Sandbox
          </span>
          <span
            role="radio"
            aria-checked="false"
            aria-disabled="true"
            className="py-1.5 text-center text-ink-subtle"
            title="Available after production approval"
          >
            Live (locked)
          </span>
        </div>
        {FIELDS[method].map((f, i) => (
          <TextField
            key={f.key}
            label={f.label}
            type={f.secret ? 'password' : 'text'}
            inputMode={f.inputMode}
            autoComplete="off"
            spellCheck={false}
            value={values[f.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            error={errors[f.key]}
            hint={f.hint}
            data-autofocus={i === 0 ? true : undefined}
          />
        ))}
        <p className="text-[12.5px] text-ink-subtle">
          Credentials are sent over TLS to a BazarHQ server function and encrypted at rest. Secret values are never returned to the app; only a masked hint may be shown.
        </p>
      </form>
    </Modal>
  );
}
