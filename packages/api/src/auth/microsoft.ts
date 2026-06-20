import { MicrosoftEntraId, decodeIdToken, generateCodeVerifier, generateState } from 'arctic';

const MICROSOFT_OAUTH_SCOPES = ['openid', 'email'];

export interface MicrosoftOAuthConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface MicrosoftIdTokenClaims {
  email?: string;
  preferred_username?: string;
  email_verified?: boolean;
  tid?: string;
  sub?: string;
}

function requireValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Microsoft OAuth`);
  return value;
}

export function assertMicrosoftOAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): MicrosoftOAuthConfig {
  return {
    tenantId: requireValue(env, 'MICROSOFT_TENANT_ID'),
    clientId: requireValue(env, 'MICROSOFT_CLIENT_ID'),
    clientSecret: requireValue(env, 'MICROSOFT_CLIENT_SECRET'),
    redirectUri: requireValue(env, 'MICROSOFT_OAUTH_REDIRECT_URI'),
  };
}

function createMicrosoftClient(env: NodeJS.ProcessEnv): MicrosoftEntraId {
  const { tenantId, clientId, clientSecret, redirectUri } = assertMicrosoftOAuthConfig(env);
  return new MicrosoftEntraId(tenantId, clientId, clientSecret, redirectUri);
}

export interface MicrosoftAuthorizationRequest {
  url: URL;
  state: string;
  codeVerifier: string;
}

export function createMicrosoftAuthorizationURL(
  env: NodeJS.ProcessEnv = process.env,
): MicrosoftAuthorizationRequest {
  const microsoft = createMicrosoftClient(env);
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = microsoft.createAuthorizationURL(state, codeVerifier, MICROSOFT_OAUTH_SCOPES);
  return { url, state, codeVerifier };
}

export async function exchangeMicrosoftCode(
  code: string,
  codeVerifier: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MicrosoftIdTokenClaims> {
  const microsoft = createMicrosoftClient(env);
  const tokens = await microsoft.validateAuthorizationCode(code, codeVerifier);
  return decodeIdToken(tokens.idToken()) as MicrosoftIdTokenClaims;
}
