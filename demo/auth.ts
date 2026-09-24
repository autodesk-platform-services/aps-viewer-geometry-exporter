// Minimal APS OAuth (3-legged, authorization code with PKCE) for a public "Single-Page App" client.
// https://aps.autodesk.com/en/docs/oauth/v2/tutorials/get-3-legged-token-pkce/
// The token is kept in sessionStorage, so it's shared by reloads but not by other tabs.

const AUTH_URL = 'https://developer.api.autodesk.com/authentication/v2';
const TOKEN_KEY = 'aps-demo-token';
const PKCE_KEY = 'aps-demo-pkce';

interface StoredToken {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number; // ms since epoch
}

export interface AuthConfig {
    clientId: string;
    scopes: string[];
    /** Must match a callback URL registered for the APS app. */
    redirectUri: string;
}

function base64url(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(byteLength: number): string {
    return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function loadToken(): StoredToken | null {
    const json = sessionStorage.getItem(TOKEN_KEY);
    return json ? JSON.parse(json) as StoredToken : null;
}

function saveToken(response: { access_token: string; refresh_token?: string; expires_in: number }): StoredToken {
    const token: StoredToken = {
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        expiresAt: Date.now() + response.expires_in * 1000
    };
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    return token;
}

async function requestToken(body: Record<string, string>): Promise<StoredToken> {
    const response = await fetch(`${AUTH_URL}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(body)
    });
    if (!response.ok) {
        throw new Error(`Token request failed: ${response.status} ${await response.text()}`);
    }
    return saveToken(await response.json());
}

export class Auth {
    private config: AuthConfig;
    private refreshing: Promise<StoredToken> | null = null;

    constructor(config: AuthConfig) {
        this.config = config;
    }

    get isLoggedIn(): boolean {
        return loadToken() !== null;
    }

    /** Redirects the browser to the Autodesk sign-in page. */
    async login(): Promise<never> {
        const verifier = randomString(64);
        const state = randomString(16);
        const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
        sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.config.clientId,
            redirect_uri: this.config.redirectUri,
            scope: this.config.scopes.join(' '),
            state,
            code_challenge: challenge,
            code_challenge_method: 'S256'
        });
        location.assign(`${AUTH_URL}/authorize?${params}`);
        return new Promise<never>(() => {});
    }

    logout(): void {
        sessionStorage.removeItem(TOKEN_KEY);
    }

    /**
     * Completes the login if the page was opened as the OAuth callback (`?code=...&state=...`),
     * and removes the OAuth parameters from the URL. Does nothing otherwise.
     */
    async handleCallback(): Promise<void> {
        const params = new URLSearchParams(location.search);
        const code = params.get('code');
        const error = params.get('error');
        if (!code && !error) {
            return;
        }
        history.replaceState(null, '', location.pathname);
        const pkce = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? 'null') as { verifier: string; state: string } | null;
        sessionStorage.removeItem(PKCE_KEY);
        if (error) {
            throw new Error(`Sign-in failed: ${error} ${params.get('error_description') ?? ''}`);
        }
        if (!pkce || params.get('state') !== pkce.state) {
            throw new Error('Sign-in failed: unexpected OAuth state');
        }
        await requestToken({
            grant_type: 'authorization_code',
            client_id: this.config.clientId,
            code: code!,
            code_verifier: pkce.verifier,
            redirect_uri: this.config.redirectUri
        });
    }

    /** Returns a valid access token and its remaining lifetime, refreshing it when it's about to expire. */
    async getToken(): Promise<{ accessToken: string; expiresIn: number }> {
        let token = loadToken();
        if (!token) {
            throw new Error('Not signed in');
        }
        if (token.expiresAt - Date.now() < 60_000) {
            if (!token.refreshToken) {
                this.logout();
                throw new Error('The session has expired; please sign in again');
            }
            // Refresh tokens are single-use, so concurrent callers must share one refresh request.
            this.refreshing ??= requestToken({
                grant_type: 'refresh_token',
                client_id: this.config.clientId,
                refresh_token: token.refreshToken,
                scope: this.config.scopes.join(' ')
            }).finally(() => { this.refreshing = null; });
            try {
                token = await this.refreshing;
            } catch (err) {
                this.logout();
                throw err;
            }
        }
        return { accessToken: token.accessToken, expiresIn: Math.floor((token.expiresAt - Date.now()) / 1000) };
    }
}
