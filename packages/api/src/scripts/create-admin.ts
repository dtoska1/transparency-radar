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
const USAGE =
  'Usage: pnpm --filter @tra/api admin:create -- --email admin@example.com [--reset] [--allow-remote]';

export interface CreateAdminArgs {
  email: string;
  reset: boolean;
  allowRemote: boolean;
}

export type CreateAdminResult = 'created' | 'reset' | 'exists';
export type DatabaseHostClassification = 'local' | 'remote';

export interface CreateAdminDatabaseTarget {
  hostname: string;
  requiresRemoteConfirmation: boolean;
}

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
  let allowRemote = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    if (arg === '--reset') {
      reset = true;
      continue;
    }
    if (arg === '--allow-remote') {
      allowRemote = true;
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
    throw new Error(USAGE);
  }

  const normalized = normalizeEmail(email ?? '');
  if (!normalized || !normalized.includes('@')) {
    throw new Error(USAGE);
  }

  return { email: normalized, reset, allowRemote };
}

export function getDatabaseHostname(databaseUrl = process.env.DATABASE_URL): string {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  try {
    return new URL(databaseUrl).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
}

export function classifyDatabaseHost(
  databaseUrl = process.env.DATABASE_URL,
): DatabaseHostClassification {
  return LOCAL_DATABASE_HOSTS.has(getDatabaseHostname(databaseUrl)) ? 'local' : 'remote';
}

export function resolveCreateAdminDatabaseTarget(
  databaseUrl = process.env.DATABASE_URL,
  allowRemote = false,
): CreateAdminDatabaseTarget {
  const hostname = getDatabaseHostname(databaseUrl);
  const classification = LOCAL_DATABASE_HOSTS.has(hostname) ? 'local' : 'remote';

  if (classification === 'remote' && !allowRemote) {
    throw new Error('create-admin is DEV-only; refusing non-local DATABASE_URL host');
  }

  return {
    hostname,
    requiresRemoteConfirmation: classification === 'remote',
  };
}

export function assertDevDatabase(databaseUrl = process.env.DATABASE_URL): void {
  resolveCreateAdminDatabaseTarget(databaseUrl, false);
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

async function promptVisible(label: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
  try {
    return await new Promise<string>((resolve) => {
      rl.question(label, resolve);
    });
  } finally {
    rl.close();
  }
}

async function confirmRemoteDatabaseHostname(hostname: string): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Interactive TTY is required for remote DATABASE_URL confirmation');
  }

  stdout.write(`Remote DATABASE_URL host: ${hostname}\n`);
  const typedHostname = await promptVisible(`Type "${hostname}" to continue: `);
  if (typedHostname !== hostname) {
    throw new Error('Remote DATABASE_URL hostname confirmation did not match; nothing was written');
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
}: Pick<CreateAdminArgs, 'email' | 'reset'> & { password: string }): Promise<CreateAdminResult> {
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
  const databaseTarget = resolveCreateAdminDatabaseTarget(
    process.env.DATABASE_URL,
    args.allowRemote,
  );
  if (databaseTarget.requiresRemoteConfirmation) {
    await confirmRemoteDatabaseHostname(databaseTarget.hostname);
  }
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
