// Demo host page for the Geometry Exporter extension.
// Usage: demo/index.html?token=<access token>&urn=<urn>[,<urn>...]
// (the token and URNs can also be entered in a form).
import { EXTENSION_ID } from '../src/index.ts';

const params = new URLSearchParams(location.search);

function askForParams(): Promise<{ token: string; urns: string[] }> {
    const form = document.getElementById('setup') as HTMLFormElement;
    form.hidden = false;
    return new Promise(resolve => {
        form.addEventListener('submit', event => {
            event.preventDefault();
            const data = new FormData(form);
            form.hidden = true;
            const token = String(data.get('token')).trim();
            const urns = String(data.get('urn')).split(',').map(s => s.trim()).filter(Boolean);
            // Keep the values in the URL so that a reload doesn't ask again.
            history.replaceState(null, '', `?token=${encodeURIComponent(token)}&urn=${encodeURIComponent(urns.join(','))}`);
            resolve({ token, urns });
        });
    });
}

function loadDocument(urn: string): Promise<Autodesk.Viewing.Document> {
    return new Promise((resolve, reject) => {
        Autodesk.Viewing.Document.load(
            urn.startsWith('urn:') ? urn : `urn:${urn}`,
            resolve,
            (code, message) => reject(new Error(`Could not load document ${urn}: ${code} ${message}`))
        );
    });
}

async function main() {
    let token = params.get('token') ?? '';
    let urns = (params.get('urn') ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (!token || urns.length === 0) {
        ({ token, urns } = await askForParams());
    }

    // The Scene API is opt-in and must be enabled before the viewer is initialized.
    Autodesk.Viewing.FeatureFlags.set(Autodesk.Viewing.PublicFeatureFlags.SceneAPI, true);

    await new Promise<void>(resolve => Autodesk.Viewing.Initializer({ accessToken: token, env: 'AutodeskProduction2', api: 'streamingV2' }, resolve));

    const viewer = new Autodesk.Viewing.GuiViewer3D(document.getElementById('viewer')!);
    viewer.start();
    const extension = await viewer.loadExtension(EXTENSION_ID);
    // Handy for experimenting in the browser console, e.g. `exporter.inspect()` or `exporter.download({ format: 'glb' })`.
    Object.assign(window, { viewer, exporter: extension });

    for (const urn of urns) {
        const doc = await loadDocument(urn);
        await viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry(), { keepCurrentModels: true });
    }
    console.log('[demo] models loaded; use the toolbar button or `exporter` in the console');
}

main().catch(err => {
    console.error(err);
    alert(err.message ?? err);
});
