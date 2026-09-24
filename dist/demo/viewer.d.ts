export type TokenProvider = () => Promise<{
    accessToken: string;
    expiresIn: number;
}>;
export declare function initViewer(container: HTMLElement, getToken: TokenProvider, onTokenError: (err: Error) => void): Promise<Autodesk.Viewing.GuiViewer3D>;
/**
 * Replaces the loaded design with the default geometry of the given one. Resolves to `false` (and doesn't report
 * errors) when another design was requested in the meantime.
 */
export declare function loadDesign(viewer: Autodesk.Viewing.GuiViewer3D, urn: string, name: string): Promise<boolean>;
