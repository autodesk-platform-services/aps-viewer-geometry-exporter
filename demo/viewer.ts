// APS Viewer setup for the demo: Scene API enabled, Geometry Exporter extension loaded, one design at a time.
import { EXTENSION_ID } from '../src/index.ts';

export type TokenProvider = () => Promise<{ accessToken: string; expiresIn: number }>;

export async function initViewer(container: HTMLElement, getToken: TokenProvider, onTokenError: (err: Error) => void): Promise<Autodesk.Viewing.GuiViewer3D> {
    // The Scene API is opt-in and must be enabled before the viewer is initialized.
    Autodesk.Viewing.FeatureFlags.set(Autodesk.Viewing.PublicFeatureFlags.SceneAPI, true);

    await new Promise<void>(resolve => Autodesk.Viewing.Initializer({
        env: 'AutodeskProduction2',
        api: 'streamingV2',
        getAccessToken: (onSuccess: (token: string, expiresIn: number) => void) => {
            getToken().then(({ accessToken, expiresIn }) => onSuccess(accessToken, expiresIn), onTokenError);
        }
    }, resolve));

    const viewer = new Autodesk.Viewing.GuiViewer3D(container);
    viewer.start();
    const extension = await viewer.loadExtension(EXTENSION_ID);
    // Handy for experimenting in the browser console, e.g. `exporter.inspect()` or `exporter.download({ format: 'glb' })`.
    Object.assign(window, { viewer, exporter: extension });
    return viewer;
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

let latestRequest = 0;

/**
 * Replaces the loaded design with the default geometry of the given one. Resolves to `false` (and doesn't report
 * errors) when another design was requested in the meantime.
 */
export async function loadDesign(viewer: Autodesk.Viewing.GuiViewer3D, urn: string, name: string): Promise<boolean> {
    const request = ++latestRequest;
    try {
        const doc = await loadDocument(urn);
        if (request !== latestRequest) {
            return false;
        }
        const node = doc.getRoot().getDefaultGeometry();
        if (!node) {
            throw new Error(`${name} has no viewable geometry (it may still be processing)`);
        }
        // Unload the previous design ourselves: letting loadDocumentNode replace it would also tear down the extensions.
        for (const model of viewer.getAllModels()) {
            viewer.unloadModel(model);
        }
        await viewer.loadDocumentNode(doc, node, { keepCurrentModels: true });
        return request === latestRequest;
    } catch (err) {
        if (request !== latestRequest) {
            return false;
        }
        throw err;
    }
}
