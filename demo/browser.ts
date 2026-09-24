// Sidebar browser of the signed-in user's Fusion / Forma (ACC, BIM 360) hubs, projects, folders and designs,
// read through the Data Management API and shown as a lazily loaded Web Awesome tree (`wa-tree`).

const API_URL = 'https://developer.api.autodesk.com';

// Data Management API responses follow JSON:API.
interface Resource {
    type: string;
    id: string;
    attributes: Record<string, any>;
    relationships?: Record<string, any>;
}

interface Page {
    data: Resource[];
    included?: Resource[];
    links?: { next?: { href: string } };
}

interface TreeNode {
    label: string;
    kind: 'hub' | 'project' | 'folder' | 'design';
    detail?: string;
    /** Lazily loads the children of an expandable node. */
    children?: () => Promise<TreeNode[]>;
    /** Called when a leaf node is clicked; leaves without it are shown disabled. */
    onSelect?: () => void;
    tooltip?: string;
}

const HUB_TYPES: Record<string, string> = {
    'hubs:autodesk.core:Hub': 'Fusion',
    'hubs:autodesk.a360:PersonalHub': 'Personal',
    'hubs:autodesk.bim360:Account': 'Forma'
};

const ICONS: Record<TreeNode['kind'], string> = { hub: 'cloud', project: 'briefcase', folder: 'folder', design: 'cube' };

const byLabel = (a: TreeNode, b: TreeNode) => a.label.localeCompare(b.label);

function placeholderItem(text: string): HTMLElement {
    const item = document.createElement('wa-tree-item');
    item.toggleAttribute('disabled', true);
    item.classList.add('placeholder');
    item.textContent = text;
    return item;
}

export interface DesignBrowserOptions {
    getAccessToken: () => Promise<string>;
    /** Called when the user selects a design; `urn` is its (base64-encoded) viewable URN. */
    onOpen: (urn: string, name: string) => void;
}

export class DesignBrowser {
    private tree: HTMLElement;
    private options: DesignBrowserOptions;
    // Actions of the selectable (design) tree items; the tree must be in `leaf` selection mode.
    private selectHandlers = new WeakMap<Element, () => void>();

    constructor(tree: HTMLElement, options: DesignBrowserOptions) {
        this.tree = tree;
        this.options = options;
        tree.addEventListener('wa-selection-change', event => {
            const [item] = (event as CustomEvent<{ selection: Element[] }>).detail.selection;
            if (item) {
                this.selectHandlers.get(item)?.();
            }
        });
    }

    /** Loads the hubs into the tree and returns their number. */
    async load(): Promise<number> {
        const hubs = await this.getHubs();
        this.tree.replaceChildren(...hubs.map(hub => this.renderNode(hub)));
        return hubs.length;
    }

    private async apiGet<T>(url: string): Promise<T> {
        const response = await fetch(url.startsWith('http') ? url : API_URL + url, {
            headers: { Authorization: `Bearer ${await this.options.getAccessToken()}` }
        });
        if (!response.ok) {
            throw new Error(`GET ${url} failed: ${response.status} ${await response.text()}`);
        }
        return response.json();
    }

    /** Fetches all pages of a paginated collection. */
    private async apiGetAll(url: string): Promise<{ data: Resource[]; included: Resource[] }> {
        const data: Resource[] = [];
        const included: Resource[] = [];
        for (let next: string | undefined = url; next; ) {
            const page: Page = await this.apiGet<Page>(next);
            data.push(...page.data);
            included.push(...(page.included ?? []));
            next = page.links?.next?.href;
        }
        return { data, included };
    }

    private async getHubs(): Promise<TreeNode[]> {
        const { data } = await this.apiGetAll('/project/v1/hubs');
        return data.map(hub => ({
            label: hub.attributes.name,
            kind: 'hub' as const,
            detail: HUB_TYPES[hub.attributes.extension?.type],
            children: () => this.getProjects(hub.id)
        })).sort(byLabel);
    }

    private async getProjects(hubId: string): Promise<TreeNode[]> {
        const { data } = await this.apiGetAll(`/project/v1/hubs/${encodeURIComponent(hubId)}/projects`);
        return data.map(project => ({
            label: project.attributes.name,
            kind: 'project' as const,
            children: () => this.getTopFolders(hubId, project.id)
        })).sort(byLabel);
    }

    private async getTopFolders(hubId: string, projectId: string): Promise<TreeNode[]> {
        const { data } = await this.apiGetAll(`/project/v1/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(projectId)}/topFolders`);
        return data.map(folder => this.folderNode(projectId, folder)).sort(byLabel);
    }

    private folderNode(projectId: string, folder: Resource): TreeNode {
        return {
            label: folder.attributes.displayName ?? folder.attributes.name,
            kind: 'folder',
            children: () => this.getFolderContents(projectId, folder.id)
        };
    }

    private async getFolderContents(projectId: string, folderId: string): Promise<TreeNode[]> {
        const { data, included } = await this.apiGetAll(`/data/v1/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderId)}/contents`);
        const folders = data.filter(entry => entry.type === 'folders').map(folder => this.folderNode(projectId, folder)).sort(byLabel);
        const items = data.filter(entry => entry.type === 'items').map(item => {
            // The response includes the tip (latest) version of each item, which links to its viewable derivatives.
            const tip = included.find(version => version.id === item.relationships?.tip?.data?.id);
            const urn: string | undefined = tip?.relationships?.derivatives?.data?.id;
            const label: string = item.attributes.displayName;
            return {
                label,
                kind: 'design' as const,
                detail: tip?.attributes.versionNumber ? `v${tip.attributes.versionNumber}` : undefined,
                onSelect: urn ? () => this.options.onOpen(urn, label) : undefined,
                tooltip: urn ? undefined : 'No viewable available for this item'
            };
        }).sort(byLabel);
        return [...folders, ...items];
    }

    private renderNode(node: TreeNode): HTMLElement {
        const item = document.createElement('wa-tree-item');
        const icon = document.createElement('wa-icon');
        icon.setAttribute('name', ICONS[node.kind]);
        icon.setAttribute('variant', 'regular');
        item.append(icon, node.label);
        if (node.detail) {
            const detail = document.createElement('small');
            detail.textContent = node.detail;
            item.append(detail);
        }
        if (node.tooltip) {
            item.title = node.tooltip;
        }

        if (node.children) {
            const loadChildren = node.children;
            item.toggleAttribute('lazy', true);
            item.addEventListener('wa-lazy-load', async event => {
                if (event.target !== item) {
                    return;
                }
                try {
                    const children = await loadChildren();
                    item.append(...(children.length > 0 ? children.map(child => this.renderNode(child)) : [placeholderItem('(empty)')]));
                } catch (err) {
                    console.error(err);
                    item.append(placeholderItem('Could not load the content (see the console)'));
                }
                item.removeAttribute('lazy');
            });
        } else if (node.onSelect) {
            this.selectHandlers.set(item, node.onSelect);
        } else {
            item.toggleAttribute('disabled', true);
        }
        return item;
    }
}
