export interface AuthConfig {
    clientId: string;
    scopes: string[];
    /** Must match a callback URL registered for the APS app. */
    redirectUri: string;
}
export declare class Auth {
    private config;
    private refreshing;
    constructor(config: AuthConfig);
    get isLoggedIn(): boolean;
    /** Redirects the browser to the Autodesk sign-in page. */
    login(): Promise<never>;
    logout(): void;
    /**
     * Completes the login if the page was opened as the OAuth callback (`?code=...&state=...`),
     * and removes the OAuth parameters from the URL. Does nothing otherwise.
     */
    handleCallback(): Promise<void>;
    /** Returns a valid access token and its remaining lifetime, refreshing it when it's about to expire. */
    getToken(): Promise<{
        accessToken: string;
        expiresIn: number;
    }>;
}
