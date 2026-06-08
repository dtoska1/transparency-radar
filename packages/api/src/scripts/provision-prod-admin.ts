import { randomUUID } from 'node:crypto';
import { stdin, stdout } from 'node:process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';
import { ARGON2_OPTIONS } from '../auth/password.js';

export const PROD_PROVISION_OPT_IN = 'I_UNDERSTAND_THIS_WRITES_NEON';
const MIN_PASSWORD_LENGTH = 12;

interface HiddenPrompt {
  _writeToOutput(input: string): void;
  question(query: string, callback: (answer: string) => void): void;
}

export interface ProvisionAdminStore {
  insertIfEmpty(input: {
    id: string;
    email: string;
    password_hash: string;
  }): Promise<boolean>;
}

export function assertProductionProvisionTarget(env: NodeJS.ProcessEnv = process.env): URL {
  if (env.TRA_ALLOW_PROD_ADMIN_PROVISION !== PROD_PROVISION_OPT_IN) {
    throw new Error('Production provisioning requires the exact explicit opt-in flag');
  }

  const rawDatabaseUrl = env.DATABASE_URL?.trim();
  if (!rawDatabaseUrl) throw new Error('DATABASE_URL is required');

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawDatabaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    !databaseUrl.hostname.endsWith('.neon.tech')
  ) {
    throw new Error('Production provisioning requires a Neon PostgreSQL host');
  }

  return databaseUrl;
}

export function normalizeProvisionEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) {
    throw new Error('A valid admin email is required');
  }
  return normalized;
}

export function validateProvisionPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH.toString()} characters`);
  }
}

export async function provisionFirstAdmin(
  input: { email: string; password: string },
  store: ProvisionAdminStore,
): Promise<void> {
  const email = normalizeProvisionEmail(input.email);
  validateProvisionPassword(input.password);
  const password_hash = await hash(input.password, ARGON2_OPTIONS);
  const created = await store.insertIfEmpty({
    id: randomUUID(),
    email,
    password_hash,
  });

  if (!created) {
    throw new Error('Provisioning refused: an admin user already exists');
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

async function createStore(): Promise<ProvisionAdminStore> {
  const [{ admin_users, db }, { sql }] = await Promise.all([
    import('@tra/db'),
    import('drizzle-orm'),
  ]);

  return {
    async insertIfEmpty(input) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`LOCK TABLE ${admin_users} IN EXCLUSIVE MODE`);
        const [existing] = await tx.select({ count: sql<number>`count(*)::int` }).from(admin_users);
        if (!existing || existing.count !== 0) return false;

        await tx.insert(admin_users).values(input);
        return true;
      });
    },
  };
}

async function main(): Promise<void> {
  const target = assertProductionProvisionTarget();
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Interactive TTY is required for production provisioning');
  }

  const email = normalizeProvisionEmail(await promptVisible('Admin email: '));
  const password = await promptHidden('Password: ');
  const confirmation = await promptHidden('Confirm password: ');
  if (password !== confirmation) throw new Error('Passwords do not match');
  validateProvisionPassword(password);

  const expectedConfirmation = `PROVISION ${email} ON ${target.hostname}`;
  stdout.write(`Target host: ${target.hostname}\nAdmin email: ${email}\n`);
  const typedConfirmation = await promptVisible(`Type "${expectedConfirmation}" to continue: `);
  if (typedConfirmation !== expectedConfirmation) {
    throw new Error('Target confirmation did not match; nothing was written');
  }

  const store = await createStore();
  await provisionFirstAdmin({ email, password }, store);
  stdout.write('Production admin user created.\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Provisioning failed');
    process.exit(1);
  });
}
