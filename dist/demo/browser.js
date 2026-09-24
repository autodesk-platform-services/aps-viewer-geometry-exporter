// Sidebar browser of the signed-in user's Fusion / Forma (ACC, BIM 360) hubs, projects, folders and designs,
// read through the Data Management API and shown as a lazily loaded Web Awesome tree (`wa-tree`).
const API_URL = 'https://developer.api.autodesk.com';
const HUB_TYPES = {
    'hubs:autodesk.core:Hub': 'Fusion',
    'hubs:autodesk.a360:PersonalHub': 'Personal',
    'hubs:autodesk.bim360:Account': 'Forma'
};
const ICONS = { hub: 'cloud', project: 'briefcase', folder: 'folder', design: 'cube' };
const byLabel = (a, b) => a.label.localeCompare(b.label);
function placeholderItem(text) {
    const item = document.createElement('wa-tree-item');
    item.toggleAttribute('disabled', true);
    item.classList.add('placeholder');
    item.textContent = text;
    return item;
}
export class DesignBrowser {
    tree;
    options;
    // Actions of the selectable (design) tree items; the tree must be in `leaf` selection mode.
    selectHandlers = new WeakMap();
    constructor(tree, options) {
        this.tree = tree;
        this.options = options;
        tree.addEventListener('wa-selection-change', event => {
            const [item] = event.detail.selection;
            if (item) {
                this.selectHandlers.get(item)?.();
            }
        });
    }
    /** Loads the hubs into the tree and returns their number. */
    async load() {
        const hubs = await this.getHubs();
        this.tree.replaceChildren(...hubs.map(hub => this.renderNode(hub)));
        return hubs.length;
    }
    async apiGet(url) {
        const response = await fetch(url.startsWith('http') ? url : API_URL + url, {
            headers: { Authorization: `Bearer ${await this.options.getAccessToken()}` }
        });
        if (!response.ok) {
            throw new Error(`GET ${url} failed: ${response.status} ${await response.text()}`);
        }
        return response.json();
    }
    /** Fetches all pages of a paginated collection. */
    async apiGetAll(url) {
        const data = [];
        const included = [];
        for (let next = url; next;) {
            const page = await this.apiGet(next);
            data.push(...page.data);
            included.push(...(page.included ?? []));
            next = page.links?.next?.href;
        }
        return { data, included };
    }
    async getHubs() {
        const { data } = await this.apiGetAll('/project/v1/hubs');
        return data.map(hub => ({
            label: hub.attributes.name,
            kind: 'hub',
            detail: HUB_TYPES[hub.attributes.extension?.type],
            children: () => this.getProjects(hub.id)
        })).sort(byLabel);
    }
    async getProjects(hubId) {
        const { data } = await this.apiGetAll(`/project/v1/hubs/${encodeURIComponent(hubId)}/projects`);
        return data.map(project => ({
            label: project.attributes.name,
            kind: 'project',
            children: () => this.getTopFolders(hubId, project.id)
        })).sort(byLabel);
    }
    async getTopFolders(hubId, projectId) {
        const { data } = await this.apiGetAll(`/project/v1/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(projectId)}/topFolders`);
        return data.map(folder => this.folderNode(projectId, folder)).sort(byLabel);
    }
    folderNode(projectId, folder) {
        return {
            label: folder.attributes.displayName ?? folder.attributes.name,
            kind: 'folder',
            children: () => this.getFolderContents(projectId, folder.id)
        };
    }
    async getFolderContents(projectId, folderId) {
        const { data, included } = await this.apiGetAll(`/data/v1/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderId)}/contents`);
        const folders = data.filter(entry => entry.type === 'folders').map(folder => this.folderNode(projectId, folder)).sort(byLabel);
        const items = data.filter(entry => entry.type === 'items').map(item => {
            // The response includes the tip (latest) version of each item, which links to its viewable derivatives.
            const tip = included.find(version => version.id === item.relationships?.tip?.data?.id);
            const urn = tip?.relationships?.derivatives?.data?.id;
            const label = item.attributes.displayName;
            return {
                label,
                kind: 'design',
                detail: tip?.attributes.versionNumber ? `v${tip.attributes.versionNumber}` : undefined,
                onSelect: urn ? () => this.options.onOpen(urn, label) : undefined,
                tooltip: urn ? undefined : 'No viewable available for this item'
            };
        }).sort(byLabel);
        return [...folders, ...items];
    }
    renderNode(node) {
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
            item.addEventListener('wa-lazy-load', async (event) => {
                if (event.target !== item) {
                    return;
                }
                try {
                    const children = await loadChildren();
                    item.append(...(children.length > 0 ? children.map(child => this.renderNode(child)) : [placeholderItem('(empty)')]));
                }
                catch (err) {
                    console.error(err);
                    item.append(placeholderItem('Could not load the content (see the console)'));
                }
                item.removeAttribute('lazy');
            });
        }
        else if (node.onSelect) {
            this.selectHandlers.set(item, node.onSelect);
        }
        else {
            item.toggleAttribute('disabled', true);
        }
        return item;
    }
}
//# sourceMappingURL=browser.js.map