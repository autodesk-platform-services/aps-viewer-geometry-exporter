export interface DesignBrowserOptions {
    getAccessToken: () => Promise<string>;
    /** Called when the user selects a design; `urn` is its (base64-encoded) viewable URN. */
    onOpen: (urn: string, name: string) => void;
}
export declare class DesignBrowser {
    private tree;
    private options;
    private selectHandlers;
    constructor(tree: HTMLElement, options: DesignBrowserOptions);
    /** Loads the hubs into the tree and returns their number. */
    load(): Promise<number>;
    private apiGet;
    /** Fetches all pages of a paginated collection. */
    private apiGetAll;
    private getHubs;
    private getProjects;
    private getTopFolders;
    private folderNode;
    private getFolderContents;
    private renderNode;
}
