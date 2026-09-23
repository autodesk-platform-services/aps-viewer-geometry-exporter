// Minimal fakes of the APS Viewer Scene API, installed on globalThis.Autodesk, plus the
// browser APIs three.js' exporters need under Node.

type Vec3 = { x: number; y: number; z: number };

export class FakeBufferAttribute {
    array: ArrayLike<number>;
    itemSize: number;
    normalized?: boolean;
    bytesPerItem?: number;
    private interleaved: boolean;
    private offset: number;
    private stride: number;

    constructor(array: ArrayLike<number>, itemSize: number, layout?: { stride: number; offset: number; bytesPerItem?: number; normalized?: boolean }) {
        this.array = array;
        this.itemSize = itemSize;
        this.interleaved = !!layout;
        this.offset = layout?.offset ?? 0;
        this.stride = layout?.stride ?? itemSize;
        if (layout?.bytesPerItem !== undefined) this.bytesPerItem = layout.bytesPerItem;
        if (layout?.normalized !== undefined) this.normalized = layout.normalized;
    }
    isInterleaved() { return this.interleaved; }
    getOffset() { return this.offset; }
    getStride() { return this.stride; }
}

export interface FakeGeometryInit {
    positions: number[];
    normals?: number[] | null;
    indices?: number[] | null;
    uv?: FakeBufferAttribute | null;
    color?: FakeBufferAttribute | null;
    vertexCount?: number;
}

export class FakeBufferGeometry {
    init: FakeGeometryInit;
    constructor(init: FakeGeometryInit) { this.init = init; }
    getVertexCount() { return this.init.vertexCount ?? this.init.positions.length / 3; }
    getPositionReader() {
        const p = this.init.positions;
        return (i: number, out: Vec3) => { out.x = p[i * 3]; out.y = p[i * 3 + 1]; out.z = p[i * 3 + 2]; };
    }
    getNormalReader() {
        const n = this.init.normals;
        if (!n) return null;
        return (i: number, out: Vec3) => { out.x = n[i * 3]; out.y = n[i * 3 + 1]; out.z = n[i * 3 + 2]; };
    }
    getIndices() { return this.init.indices ? new Uint16Array(this.init.indices) : null; }
    getEdgeIndices() { return null; }
    hasAttribute(name: string) {
        if (name === 'position') return true;
        if (name === 'normal') return !!this.init.normals || !!(this.init as any).normal;
        return !!(this.init as any)[name];
    }
    getAttribute(name: string) { return (this.init as any)[name] ?? null; }
    isInterleaved() { return false; }
    isCommitted() { return true; }
}

type ColorInit = { r: number; g: number; b: number };

class FakeMaterialBase {
    params: Record<string, any>;
    constructor(params: Record<string, any> = {}) {
        this.params = { color: { r: 1, g: 1, b: 1 }, opacity: 1, transparent: false, vertexColors: false, depthTest: true, depthWrite: true, side: Side.Front, ...params };
    }
    getColor(): ColorInit { return this.params.color; }
    getOpacity() { return this.params.opacity; }
    getTransparent() { return this.params.transparent; }
    getVertexColors() { return this.params.vertexColors; }
    getDepthTest() { return this.params.depthTest; }
    getDepthWrite() { return this.params.depthWrite; }
    getSide() { return this.params.side; }
    getMap() { return this.params.map ?? null; }
}

export class FakeStandardMaterial extends FakeMaterialBase {
    getSpecularPower() { return this.params.specularPower ?? 30; }
    getMetal() { return this.params.metal ?? false; }
    getSpecularColor() { return { r: 0.1, g: 0.1, b: 0.1 }; }
}
export class FakeUnlitMaterial extends FakeMaterialBase {}
export class FakeLineMaterial extends FakeMaterialBase {}
export class FakePointsMaterial extends FakeMaterialBase {
    getSize() { return this.params.size ?? 2; }
}

export const Side = { Front: 0, Back: 1, Double: 2 };

export class FakeMatrix4 {
    elements = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export class FakeVector3 {
    x = 0; y = 0; z = 0;
}

export interface FakeInstance {
    geometry: unknown;
    material: unknown;
    /** Column-major 4x4 matrix. */
    matrix?: number[];
    dbId?: number;
}

export function translation(x: number, y: number, z: number): number[] {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

export class FakeInstanceCollection {
    items: FakeInstance[];
    constructor(items: FakeInstance[]) { this.items = items; }
    getCount() { return this.items.length; }
    getGeometry(id: number) { return this.items[id].geometry ?? null; }
    getMaterial(id: number) { return this.items[id].material ?? null; }
    getDbId(id: number) { return this.items[id].dbId ?? id + 1; }
    getTransformWorld(id: number, target: FakeMatrix4) {
        const m = this.items[id].matrix ?? translation(0, 0, 0);
        for (let i = 0; i < 16; i++) target.elements[i] = m[i];
        return target;
    }
}

export class FakeModel {
    id: number;
    instances: FakeInstanceCollection;
    names: Record<number, string>;
    unitScale: number;
    constructor(items: FakeInstance[], options: { id?: number; names?: Record<number, string>; unitScale?: number } = {}) {
        this.id = options.id ?? 1;
        this.instances = new FakeInstanceCollection(items);
        this.names = options.names ?? {};
        this.unitScale = options.unitScale ?? 1;
    }
    getInstances() { return this.instances; }
    async getObjectTreeAsync() {
        const names = this.names;
        return {
            getRootId: () => 1,
            getNodeName: (dbId: number) => names[dbId] ?? '',
            enumNodeInstances: () => {},
        };
    }
    getUnitScale() { return this.unitScale; }
    getData() { return { urn: `fake-urn-${this.id}` }; }
    getDocumentNode() { return null; }
}

/** A unit square in the XY plane made of two triangles. */
export function quadGeometry(extra: Partial<FakeGeometryInit> = {}): FakeBufferGeometry {
    return new FakeBufferGeometry({
        positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
        normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
        indices: [0, 1, 2, 0, 2, 3],
        ...extra,
    });
}

class FileReaderPolyfill {
    result: ArrayBuffer | string | null = null;
    onload: ((e: unknown) => void) | null = null;
    onloadend: ((e: unknown) => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
        blob.arrayBuffer().then(buffer => {
            this.result = buffer;
            this.onload?.({ target: this });
            this.onloadend?.({ target: this });
        });
    }
    readAsDataURL(blob: Blob) {
        blob.arrayBuffer().then(buffer => {
            this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
            this.onload?.({ target: this });
            this.onloadend?.({ target: this });
        });
    }
}

export function installFakes(): void {
    const g = globalThis as any;
    g.Autodesk = {
        Viewing: {
            Scene: {
                BufferGeometry: FakeBufferGeometry,
                BufferAttribute: FakeBufferAttribute,
                StandardMaterial: FakeStandardMaterial,
                UnlitMaterial: FakeUnlitMaterial,
                LineMaterial: FakeLineMaterial,
                PointsMaterial: FakePointsMaterial,
                Side,
            },
            Math: { Matrix4: FakeMatrix4, Vector3: FakeVector3 },
        },
    };
    if (typeof g.FileReader === 'undefined') {
        g.FileReader = FileReaderPolyfill;
    }
}

installFakes();
