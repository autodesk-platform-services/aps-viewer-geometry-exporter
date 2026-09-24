// Demo host page with Autodesk sign-in: browse your own Fusion / Forma (ACC, BIM 360) hubs, projects and
// folders through the Data Management API, and open a design in the viewer with the Geometry Exporter loaded.
// Usage: demo/index.html (the page's URL must be registered as a callback URL of the APS app).
// The UI uses Web Awesome components (https://webawesome.com), loaded from their CDN in index.html.
import { Auth } from './auth.ts';
import { DesignBrowser } from './browser.ts';
import { initViewer, loadDesign } from './viewer.ts';

const CLIENT_ID = 'YmHvRac8ZID6GHVY3R9skAcVZ8joHmyYT1RH7mvic7kEpTM9';

const auth = new Auth({
    clientId: CLIENT_ID,
    scopes: ['data:read', 'viewables:read', 'user-profile:read'],
    redirectUri: location.origin + location.pathname
});

const getAccessToken = async () => (await auth.getToken()).accessToken;

function setStatus(message: string, isError = false) {
    const status = document.getElementById('status')!;
    status.textContent = message;
    status.setAttribute('variant', isError ? 'danger' : 'neutral');
}

async function showUserName() {
    try {
        const response = await fetch('https://api.userprofile.autodesk.com/userinfo', {
            headers: { Authorization: `Bearer ${await getAccessToken()}` }
        });
        if (!response.ok) {
            throw new Error(`${response.status} ${await response.text()}`);
        }
        const profile: { name?: string; email?: string; picture?: string } = await response.json();
        const name = profile.name ?? profile.email ?? '';
        document.getElementById('user')!.textContent = name;
        const avatar = document.querySelector('#sidebar wa-avatar')!;
        avatar.setAttribute('label', name);
        if (profile.picture) {
            avatar.setAttribute('image', profile.picture);
        }
    } catch (err) {
        console.warn('[demo] could not read the user profile', err);
    }
}

async function main() {
    await auth.handleCallback();

    if (!auth.isLoggedIn) {
        document.getElementById('redirect-uri')!.textContent = location.origin + location.pathname;
        const login = document.getElementById('login')!;
        login.hidden = false;
        login.querySelector('wa-button')!.addEventListener('click', () => auth.login());
        return;
    }

    document.getElementById('sidebar')!.hidden = false;
    document.getElementById('logout')!.addEventListener('click', () => {
        auth.logout();
        location.reload();
    });
    showUserName();

    const viewerReady = initViewer(document.getElementById('viewer')!, () => auth.getToken(), err => setStatus(err.message, true));

    const browser = new DesignBrowser(document.getElementById('tree')!, {
        getAccessToken,
        onOpen: async (urn, name) => {
            setStatus(`Opening ${name}…`);
            try {
                if (await loadDesign(await viewerReady, urn, name)) {
                    setStatus(`${name} loaded; use the toolbar button or \`exporter\` in the console to export it.`);
                }
            } catch (err) {
                console.error(err);
                setStatus((err as Error).message, true);
            }
        }
    });

    setStatus('Loading hubs…');
    const hubCount = await browser.load();
    setStatus(hubCount > 0 ? 'Select a design to open it.' : 'No hubs found for this account.');
    await viewerReady;
}

main().catch(err => {
    console.error(err);
    const sidebarShown = !document.getElementById('sidebar')!.hidden;
    if (sidebarShown) {
        setStatus(err.message ?? String(err), true);
    } else {
        alert(err.message ?? err);
    }
});
