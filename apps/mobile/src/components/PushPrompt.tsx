import { useState } from 'react';
import { Alert, Button, useServices } from '@bazarhq/ui';
import { enablePush, pushSupported } from '@/services/native';

/** MOB-10/18: notification permission is requested only when the user taps "Turn on". */
export function PushPrompt({ text }: { text: string }) {
  const services = useServices();
  const [state, setState] = useState<'idle' | 'granted' | 'denied'>('idle');
  if (!pushSupported() || state === 'granted') return null;
  return (
    <Alert
      tone={state === 'denied' ? 'warning' : 'info'}
      className="mb-3"
      action={
        state === 'idle' && (
          <Button
            size="sm"
            onClick={async () => {
              const r = await enablePush((token) => void services.notifications.registerDevice({ token, platform: 'android' }).catch(() => undefined));
              setState(r === 'granted' ? 'granted' : 'denied');
            }}
          >
            Turn on
          </Button>
        )
      }
    >
      {state === 'denied' ? 'Push notifications are off. You can enable them in Android settings.' : text}
    </Alert>
  );
}
