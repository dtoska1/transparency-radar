import { Google, decodeIdToken, generateCodeVerifier, generateState } from 'arctic';

const GOOGLE_OAUTH_SCOPES = ['openid', 'email'];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleIdTokenClaims {
  email?: string;
  email_verified?: boolean;
  sub?: string;
}

function requireValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Google OAuth`);
  return value;
}

export function assertGoogleOAuthConfig(env: NodeJS.ProcessEnv = process.env): GoogleOAuthConfig {
  return {
    clientId: requireValue(env, 'GOOGLE_CLIENT_ID'),
    clientSecret: requireValue(env, 'GOOGLE_CLIENT_SECRET'),
    redirectUri: requireValue(env, 'GOOGLE_OAUTH_REDIRECT_URI'),
  };
}

function createGoogleClient(env: NodeJS.ProcessEnv): Google {
  const { clientId, clientSecret, redirectUri } = assertGoogleOAuthConfig(env);
  return new Google(clientId, clientSecret, redirectUri);
}

export interface GoogleAuthorizationRequest {
  url: URL;
  state: string;
  codeVerifier: string;
}

export function createGoogleAuthorizationURL(
  env: NodeJS.ProcessEnv = process.env,
): GoogleAuthorizationRequest {
  const google = createGoogleClient(env);
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = google.createAuthorizationURL(state, codeVerifier, GOOGLE_OAUTH_SCOPES);
  return { url, state, codeVerifier };
}

export async function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GoogleIdTokenClaims> {
  const google = createGoogleClient(env);
  const tokens = await google.validateAuthorizationCode(code, codeVerifier);
  return decodeIdToken(tokens.idToken()) as GoogleIdTokenClaims;
}
