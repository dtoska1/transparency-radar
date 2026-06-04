import { type Options, verify } from '@node-rs/argon2';

export const ARGON2_OPTIONS = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} satisfies Options;

export const DUMMY_LOGIN_PASSWORD = 'tra-dummy-login-password';
export const DUMMY_ARGON2ID_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$A+lFjkZCBpQTg3h/0wV+tQ$a4OikYSj8/WTVQEpuzNQ3hAAKxi5GxZYLErMrNn+KDQ';

export async function verifyPasswordHash(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
