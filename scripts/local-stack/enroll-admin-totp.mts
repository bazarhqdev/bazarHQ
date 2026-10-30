
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

function envValue(contents: string, key: string): string | undefined {
  const line = contents.split(/\r?\n/).find((item) =>
    new RegExp(`^\\s*${key}\\s*=`).test(item),
  );

  if (!line) return undefined;

  const value = line.slice(line.indexOf('=') + 1).trim();
  return value.replace(/^(["'])(.*)\1$/, '$2');
}

function ask(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askHidden(question: string): Promise<string> {
  const input = process.stdin;
  const output = process.stdout;

  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return ask(`${question} (warning: input may be visible): `);
  }

  return new Promise((resolve, reject) => {
    let answer = '';

    output.write(question);

    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString('utf8');

      for (const char of text) {
        if (char === '\u0003') {
          input.setRawMode(false);
          input.pause();
          input.removeListener('data', onData);
          output.write('\nCancelled.\n');
          reject(new Error('Cancelled by user'));
          return;
        }

        if (char === '\r' || char === '\n') {
          input.setRawMode(false);
          input.pause();
          input.removeListener('data', onData);
          output.write('\n');
          resolve(answer);
          return;
        }

        if (char === '\u0008' || char === '\u007f') {
          answer = answer.slice(0, -1);
        } else if (char >= ' ') {
          answer += char;
        }
      }
    };

    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

async function main(): Promise<void> {
  let env: string;

  try {
    env = readFileSync('apps/web/.env.local', 'utf8');
  } catch {
    throw new Error(
      'Run this script from the BazarHQ repository root; apps/web/.env.local was not found.',
    );
  }

  const url = envValue(env, 'NEXT_PUBLIC_SUPABASE_URL');
  const key = envValue(env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY');

  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing from apps/web/.env.local.',
    );
  }

  if (
    !url.startsWith('http://127.0.0.1:54321') &&
    !url.startsWith('http://localhost:54321')
  ) {
    throw new Error(
      `This helper is for local development only. Unexpected Supabase URL: ${url}`,
    );
  }

  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const email = (await ask('Super Admin email: ')).toLowerCase();
  const password = await askHidden(
    'Super Admin password (input hidden): ',
  );

  if (!email || !password) {
    throw new Error('Email and password are required.');
  }

  const { data: signInData, error: signInError } =
    await supabase.auth.signInWithPassword({ email, password });

  if (signInError || !signInData.user) {
    throw new Error(
      `Sign-in failed: ${signInError?.message ?? 'No user returned'}`,
    );
  }

  try {
    const { data: factors, error: factorsError } =
      await supabase.auth.mfa.listFactors();

    if (factorsError) {
      throw new Error(
        `Could not list MFA factors: ${factorsError.message}`,
      );
    }

    const verified = factors.totp?.find(
      (factor) => factor.status === 'verified',
    );

    if (verified) {
      console.log(
        'This account already has a verified TOTP factor. No new factor was created.',
      );
      return;
    }

    const pending =
      factors.all?.filter(
        (factor) =>
          factor.factor_type === 'totp' &&
          factor.status !== 'verified',
      ) ?? [];

    if (pending.length > 0) {
      throw new Error(
        'An unverified TOTP factor already exists. Do not enroll again blindly; recover the existing factor first.',
      );
    }

    const { data: enrollment, error: enrollmentError } =
      await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'BazarHQ Local Super Admin',
      });

    if (enrollmentError || !enrollment) {
      throw new Error(
        `TOTP enrollment failed: ${enrollmentError?.message ?? 'No enrollment data returned'}`,
      );
    }

    console.log('\nTOTP enrollment created.');
    console.log(
      'Add this key manually to your authenticator app. Keep it private.',
    );
    console.log('\nTOTP SECRET:');
    console.log(enrollment.totp.secret);

    console.log(
      '\nIn your authenticator app, choose Add account / Enter setup key.',
    );
    console.log('Account label: BazarHQ Local Super Admin');
    console.log('Type: Time-based (TOTP)');
    console.log('Then enter the current six-digit code below.\n');

    let verifiedOk = false;

    for (let attempt = 1; attempt <= 5; attempt++) {
      const code = (
        await ask(`Current 6-digit authenticator code (attempt ${attempt}/5): `)
      ).replace(/\D/g, '');

      if (!/^\d{6}$/.test(code)) {
        console.log('Enter exactly six digits.');
        continue;
      }

      const { error: verifyError } =
        await supabase.auth.mfa.challengeAndVerify({
          factorId: enrollment.id,
          code,
        });

      if (!verifyError) {
        verifiedOk = true;
        break;
      }

      console.log(
        'Code was not accepted. Check your authenticator and enter the newest code.',
      );
    }

    if (!verifiedOk) {
      throw new Error(
        'TOTP verification failed after five attempts. An unverified factor may remain. Do not enroll again blindly.',
      );
    }

    const { data: assurance } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    console.log(
      `\nTOTP verified successfully. Current assurance level: ${assurance?.currentLevel ?? 'unknown'}.`,
    );

    console.log(
      'Sign out from this setup session and test the real BazarHQ Admin login.',
    );
  } finally {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(
    `\nSetup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
  );

  process.exitCode = 1;
});
