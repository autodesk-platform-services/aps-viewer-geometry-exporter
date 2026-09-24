// Minimal APS OAuth (3-legged, authorization code with PKCE) for a public "Single-Page App" client.
// https://aps.autodesk.com/en/docs/oauth/v2/tutorials/get-3-legged-token-pkce/
// The token is kept in sessionStorage, so it's shared by reloads but not by other tabs.
const AUTH_URL = 'https://developer.api.autodesk.com/authentication/v2';
const TOKEN_KEY = 'aps-demo-token';
const PKCE_KEY = 'aps-demo-pkce';
function base64url(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomString(byteLength) {
    return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}
function loadToken() {
    const json = sessionStorage.getItem(TOKEN_KEY);
    return json ? JSON.parse(json) : null;
}
function saveToken(response) {
    const token = {
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        expiresAt: Date.now() + response.expires_in * 1000
    };
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    return token;
}
async function requestToken(body) {
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
    config;
    refreshing = null;
    constructor(config) {
        this.config = config;
    }
    get isLoggedIn() {
        return loadToken() !== null;
    }
    /** Redirects the browser to the Autodesk sign-in page. */
    async login() {
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
        return new Promise(() => { });
    }
    logout() {
        sessionStorage.removeItem(TOKEN_KEY);
    }
    /**
     * Completes the login if the page was opened as the OAuth callback (`?code=...&state=...`),
     * and removes the OAuth parameters from the URL. Does nothing otherwise.
     */
    async handleCallback() {
        const params = new URLSearchParams(location.search);
        const code = params.get('code');
        const error = params.get('error');
        if (!code && !error) {
            return;
        }
        history.replaceState(null, '', location.pathname);
        const pkce = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? 'null');
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
            code: code,
            code_verifier: pkce.verifier,
            redirect_uri: this.config.redirectUri
        });
    }
    /** Returns a valid access token and its remaining lifetime, refreshing it when it's about to expire. */
    async getToken() {
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
            }
            catch (err) {
                this.logout();
                throw err;
            }
        }
        return { accessToken: token.accessToken, expiresIn: Math.floor((token.expiresAt - Date.now()) / 1000) };
    }
}
//# sourceMappingURL=auth.js.map