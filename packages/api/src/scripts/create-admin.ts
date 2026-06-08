import { randomUUID } from 'node:crypto';
import { stdin, stdout } from 'node:process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';
import { admin_users, db } from '@tra/db';
import { eq } from 'drizzle-orm';
import { ARGON2_OPTIONS } from '../auth/password.js';

const MIN_PASSWORD_LENGTH = 12;
const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', 'postgres']);

export interface CreateAdminArgs {
  email: string;
  reset: boolean;
}

export type CreateAdminResult = 'created' | 'reset' | 'exists';

interface HiddenPrompt {
  _writeToOutput(input: string): void;
  question(query: string, callback: (answer: string) => void): void;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseCreateAdminArgs(argv: string[]): CreateAdminArgs {
  let email: string | undefined;
  let reset = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    if (arg === '--reset') {
      reset = true;
      continue;
    }
    if (arg === '--email') {
      email = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--email=')) {
      email = arg.slice('--email='.length);
      continue;
    }
    throw new Error(
      'Usage: pnpm --filter @tra/api admin:create -- --email admin@example.com [--reset]',
    );
  }

  const normalized = normalizeEmail(email ?? '');
  if (!normalized || !normalized.includes('@')) {
    throw new Error(
      'Usage: pnpm --filter @tra/api admin:create -- --email admin@example.com [--reset]',
    );
  }

  return { email: normalized, reset };
}

export function assertDevDatabase(databaseUrl = process.env.DATABASE_URL): void {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  let hostname = '';
  try {
    hostname = new URL(databaseUrl).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

  if (!LOCAL_DATABASE_HOSTS.has(hostname)) {
    throw new Error('create-admin is DEV-only; refusing non-local DATABASE_URL host');
  }
}

export function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH.toString()} characters`);
  }
}

async function promptHidden(label: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
  const hidden = rl as unknown as HiddenPrompt;
  const originalWrite = hidden._writeToOutput.bind(rl);
  hidden._writeToOutput = () => {};
  stdout.write(label);

  try {
    return await new Promise<string>((resolve) => {
      hidden.question('', resolve);
    });
  } finally {
    hidden._writeToOutput = originalWrite;
    rl.close();
    stdout.write('\n');
  }
}

async function readPasswordInteractively(): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Interactive TTY is required for hidden password prompt');
  }

  const password = await promptHidden('Password: ');
  const confirm = await promptHidden('Confirm password: ');
  if (password !== confirm) {
    throw new Error('Passwords do not match');
  }
  validatePassword(password);
  return password;
}

export async function createAdminUser({
  email,
  password,
  reset,
}: CreateAdminArgs & { password: string }): Promise<CreateAdminResult> {
  const normalizedEmail = normalizeEmail(email);
  validatePassword(password);

  const [existing] = await db
    .select({ id: admin_users.id })
    .from(admin_users)
    .where(eq(admin_users.email, normalizedEmail))
    .limit(1);

  if (existing && !reset) {
    return 'exists';
  }

  const password_hash = await hash(password, ARGON2_OPTIONS);

  if (existing) {
    await db.update(admin_users).set({ password_hash }).where(eq(admin_users.id, existing.id));
    return 'reset';
  }

  await db.insert(admin_users).values({
    id: randomUUID(),
    email: normalizedEmail,
    password_hash,
  });

  return 'created';
}

async function main(argv: string[]): Promise<void> {
  const args = parseCreateAdminArgs(argv);
  assertDevDatabase();
  const password = await readPasswordInteractively();
  const result = await createAdminUser({ ...args, password });

  if (result === 'exists') {
    throw new Error('Admin user already exists; re-run with --reset to replace the password');
  }

  stdout.write(result === 'created' ? 'Admin user created.\n' : 'Admin password reset.\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then(() => {
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
