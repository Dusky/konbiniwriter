// src/lib/ClaudeOAuth.ts — "Sign in with Claude" (OAuth 2.0 + PKCE).
//
// A Claude Pro/Max subscription can only reach the Anthropic API through the
// Claude Code OAuth client, so this uses that client's public ID and the
// manual copy-paste redirect. The copy-paste flow is portable across both the
// browser and Electron builds — no loopback server or custom protocol handler
// needed. Tokens obtained here are used by AIClient.streamAnthropic with a
// Bearer header and the oauth beta flag, and requests are branded as Claude
// Code (a required system prefix), which is why this is a distinct auth mode
// rather than a drop-in for the API-key path.

import { useAIStore } from '../store/aiStore'

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize'
/** Anthropic shows the authorization code on this page for the user to copy. */
export const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback'
const SCOPES = 'org:create_api_key user:profile user:inference'

/** System prefix Anthropic requires on every request made with a subscription token. */
export const CLAUDE_CODE_SYSTEM = "You are Claude Code, Anthropic's official CLI for Claude."
export const OAUTH_BETA = 'oauth-2025-04-20'

function base64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface PKCE { verifier: string; challenge: string; state: string }

/** Generate a fresh PKCE verifier/challenge and CSRF state. */
export async function createPKCE(): Promise<PKCE> {
  const rand = (n: number) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a }
  const verifier = base64url(rand(32))
  const state = base64url(rand(16))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)), state }
}

/** Authorization URL to open in the user's browser. */
export function authorizeUrl(pkce: PKCE): string {
  const p = new URLSearchParams({
    code: 'true',
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state: pkce.state,
  })
  return `${AUTHORIZE_URL}?${p.toString()}`
}

/**
 * Exchange the pasted authorization code for tokens and persist them. The code
 * Anthropic displays is `<code>#<state>`; the state half is optional (we fall
 * back to the PKCE state we generated).
 */
export async function completeSignIn(pastedCode: string, pkce: PKCE): Promise<{ ok: boolean; error?: string }> {
  const [code, state] = pastedCode.trim().split('#')
  if (!code) return { ok: false, error: 'Paste the authorization code from the browser.' }
  const res = await window.api.oauth.exchange({
    code,
    state: state || pkce.state,
    verifier: pkce.verifier,
    redirectUri: REDIRECT_URI,
  })
  if (!res.ok || !res.accessToken) return { ok: false, error: res.error ?? 'Token exchange failed.' }
  storeTokens(res.accessToken, res.refreshToken, res.expiresIn)
  return { ok: true }
}

function storeTokens(access: string, refresh: string | undefined, expiresIn: number | undefined): void {
  const expiresAt = Date.now() + (expiresIn ?? 3600) * 1000
  useAIStore.getState().setOAuthTokens(access, refresh ?? '', expiresAt)
}

/**
 * Return a valid access token, refreshing it first if it is expired or within
 * a minute of expiry. Returns null when the user is not signed in or the
 * refresh fails (the caller should surface a "sign in again" error).
 */
export async function getValidAccessToken(): Promise<string | null> {
  const s = useAIStore.getState()
  if (!s.oauthAccessToken) return null
  if (Date.now() < s.oauthExpiresAt - 60_000) return s.oauthAccessToken
  if (!s.oauthRefreshToken) return null
  const res = await window.api.oauth.refresh({ refreshToken: s.oauthRefreshToken })
  if (!res.ok || !res.accessToken) return null
  storeTokens(res.accessToken, res.refreshToken ?? s.oauthRefreshToken, res.expiresIn)
  return res.accessToken
}
