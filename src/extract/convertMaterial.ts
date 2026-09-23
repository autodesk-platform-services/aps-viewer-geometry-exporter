import * as THREE from 'three';
import type { Diagnostics, DiagnosticContext } from '../diagnostics.ts';
import type { PrimitiveMode } from './convertGeometry.ts';

type SceneMaterial = Autodesk.Viewing.Scene.Material;
type SceneTexture = Autodesk.Viewing.Scene.Texture;

export type MaterialKind = 'standard' | 'unlit' | 'line' | 'points' | 'unknown';

export interface ConvertedMaterial {
    material: THREE.Material;
    mode: PrimitiveMode;
    kind: MaterialKind;
}

const KIND_BY_CLASS: [MaterialKind, string][] = [
    ['standard', 'StandardMaterial'],
    ['unlit', 'UnlitMaterial'],
    ['line', 'LineMaterial'],
    ['points', 'PointsMaterial'],
];

// Materials of models loaded from files are the viewer's internal (legacy three.js)
// materials rather than Scene API classes; they are recognized by their `type`.
const KIND_BY_LEGACY_TYPE: Record<string, MaterialKind> = {
    MeshPhongMaterial: 'standard',
    MeshLambertMaterial: 'standard',
    MeshBasicMaterial: 'unlit',
    LineBasicMaterial: 'line',
    LineDashedMaterial: 'line',
    PointCloudMaterial: 'points',
    PointsMaterial: 'points',
};

export interface MaterialClassification {
    kind: MaterialKind;
    /** True for internal viewer materials that don't implement the Scene API getters. */
    legacy: boolean;
    /** True for internal PRISM materials (e.g. Fusion and Inventor models). */
    prism?: boolean;
}

/** Identifies the Scene API material class (or the internal viewer material type) of `material`. */
export function classifyMaterialSource(material: unknown): MaterialClassification {
    const scene = (globalThis as any).Autodesk?.Viewing?.Scene;
    for (const [kind, className] of KIND_BY_CLASS) {
        const cls = scene?.[className];
        if (typeof cls === 'function' && material instanceof cls) {
            return { kind, legacy: false };
        }
    }
    const type = (material as any)?.type;
    if (type === 'PrismMaterial' || (material as any)?.isPrismMaterial === true) {
        return { kind: 'standard', legacy: true, prism: true };
    }
    if (typeof type === 'string' && type in KIND_BY_LEGACY_TYPE) {
        return { kind: KIND_BY_LEGACY_TYPE[type], legacy: true };
    }
    return { kind: 'unknown', legacy: false };
}

export function classifyMaterial(material: unknown): MaterialKind {
    return classifyMaterialSource(material).kind;
}

/**
 * Reads a value through the Scene API getter, or through the equivalent property for
 * internal viewer objects that don't have the getters.
 */
function accessor(source: any, legacy: boolean, getter: string, property: string): () => any {
    return legacy ? () => source[property] : () => source[getter]();
}

// Legacy three.js `vertexColors` is a number (NoColors = 0), the Scene API returns a boolean.
const legacyVertexColors = (m: any) => () => typeof m.vertexColors === 'number' ? m.vertexColors !== 0 : m.vertexColors;

/** Rough Blinn-Phong exponent → GGX roughness conversion. */
export function specularPowerToRoughness(power: number): number {
    return Math.min(1, Math.max(0, Math.sqrt(2 / (power + 2))));
}

// The Scene API texture wrap values appear to follow the three.js constants; this is
// validated at runtime and reported if not.
const KNOWN_WRAPPING = new Set<number>([THREE.RepeatWrapping, THREE.ClampToEdgeWrapping, THREE.MirroredRepeatWrapping]);

/**
 * Converts Scene API materials and textures into three.js ones. Results are cached per
 * source object so that shared materials stay shared in the export.
 */
export class MaterialConverter {
    readonly materials = new Map<SceneMaterial, ConvertedMaterial>();
    readonly textures = new Map<SceneTexture, THREE.Texture | null>();
    private fallback: ConvertedMaterial | null = null;
    private readonly diagnostics: Diagnostics;
    private readonly includeTextures: boolean;

    constructor(diagnostics: Diagnostics, options: { includeTextures: boolean }) {
        this.diagnostics = diagnostics;
        this.includeTextures = options.includeTextures;
    }

    /** Material used for instances without a (recognizable) material. */
    getFallback(): ConvertedMaterial {
        if (!this.fallback) {
            const material = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.8, metalness: 0 });
            material.name = 'Fallback';
            this.fallback = { material, mode: 'triangles', kind: 'unknown' };
        }
        return this.fallback;
    }

    convert(material: SceneMaterial | null, context: DiagnosticContext): ConvertedMaterial {
        if (!material) {
            this.diagnostics.report('no-material', context, { raw: material });
            return this.getFallback();
        }
        const cached = this.materials.get(material);
        if (cached) {
            return cached;
        }
        const converted = this.convertUncached(material, context);
        this.materials.set(material, converted);
        return converted;
    }

    private convertUncached(material: SceneMaterial, context: DiagnosticContext): ConvertedMaterial {
        const { kind, legacy, prism } = classifyMaterialSource(material);
        const d = this.diagnostics;
        const m: any = material;
        const ctx = { ...context };

        if (kind === 'unknown') {
            d.report('unknown-material-type', ctx, {
                constructorName: m?.constructor?.name,
                type: m?.type,
                flags: m && typeof m === 'object' ? Object.keys(m).filter(k => /^is[A-Z]/.test(k) && m[k] === true) : undefined,
                keys: m && typeof m === 'object' ? Object.keys(m) : typeof m,
                note: 'exported with a fallback material',
                raw: material,
            });
            return this.getFallback();
        }
        if (legacy) {
            d.report('legacy-material', ctx, {
                type: m.type,
                prismType: prism ? m.prismType : undefined,
                note: 'getMaterial() returned an internal viewer material without the Scene API getters; its properties are read directly',
                raw: material,
            });
        }
        if (prism) {
            const result = this.convertPrism(m, ctx);
            result.name = m.name || `${m.prismType || 'prism'}_${this.materials.size}`;
            return { material: result, mode: 'triangles', kind };
        }
        const get = (getter: string, property: string) => accessor(m, legacy, getter, property);

        const color = this.readColor(get('getColor', 'color'), 'color', ctx, material);
        const opacity = this.readUnitScalar(get('getOpacity', 'opacity'), 'opacity', 1, ctx, material);
        const transparent = this.readBoolean(get('getTransparent', 'transparent'), 'transparent', false, ctx, material) || opacity < 1;
        const vertexColors = this.readBoolean(legacy ? legacyVertexColors(m) : get('getVertexColors', 'vertexColors'), 'vertexColors', false, ctx, material);
        const depthTest = this.readBoolean(get('getDepthTest', 'depthTest'), 'depthTest', true, ctx, material);
        const depthWrite = this.readBoolean(get('getDepthWrite', 'depthWrite'), 'depthWrite', true, ctx, material);
        const common = { color, opacity, transparent, vertexColors, depthTest, depthWrite };

        let result: THREE.Material;
        let mode: PrimitiveMode = 'triangles';
        switch (kind) {
            case 'standard': {
                const power = this.readScalar(get('getSpecularPower', 'shininess'), 'specularPower', 30, ctx, material);
                // Legacy materials may not define `metal` at all.
                const metal = legacy && m.metal === undefined
                    ? false
                    : this.readBoolean(get('getMetal', 'metal'), 'metal', false, ctx, material);
                result = new THREE.MeshStandardMaterial({
                    ...common,
                    side: this.readSide(get('getSide', 'side'), ctx, material),
                    roughness: specularPowerToRoughness(power),
                    metalness: metal ? 1 : 0,
                    map: this.readMap(get('getMap', 'map'), ctx),
                });
                break;
            }
            case 'unlit':
                result = new THREE.MeshBasicMaterial({
                    ...common,
                    side: this.readSide(get('getSide', 'side'), ctx, material),
                    map: this.readMap(get('getMap', 'map'), ctx),
                });
                break;
            case 'line':
                mode = 'lines';
                result = new THREE.LineBasicMaterial(common);
                break;
            case 'points':
                mode = 'points';
                result = new THREE.PointsMaterial({
                    ...common,
                    size: this.readScalar(get('getSize', 'size'), 'size', 1, ctx, material),
                    map: this.readMap(get('getMap', 'map'), ctx),
                });
                break;
        }
        result.name = m.name || `${kind}_${this.materials.size}`;
        return { material: result, mode, kind };
    }

    /**
     * Approximates an internal PRISM material (see the viewer's MaterialConverterPrism) with a
     * standard PBR material. PRISM colors are stored in linear space.
     */
    private convertPrism(m: any, ctx: DiagnosticContext): THREE.MeshStandardMaterial {
        const color = (property: string) => this.readColor(() => m[property], property, ctx, m, THREE.LinearSRGBColorSpace);
        const scalar = (property: string, fallback: number) => this.readScalar(() => m[property], property, fallback, ctx, m);
        const unit = (property: string, fallback: number) => Math.min(1, scalar(property, fallback));
        const unsupported: string[] = [];

        const params: THREE.MeshStandardMaterialParameters = {
            roughness: unit('surface_roughness', 0.5),
            metalness: 0,
            side: this.readSide(() => m.side, ctx, m),
            depthTest: m.depthTest !== false,
            depthWrite: m.depthWrite !== false,
        };
        let opacity = 1;
        switch (m.prismType) {
            case 'PrismOpaque':
                params.color = color('opaque_albedo');
                if (m.opaque_luminance > 0) unsupported.push('emission (opaque_luminance)');
                break;
            case 'PrismMetal':
                params.color = color('metal_f0');
                params.metalness = 1;
                break;
            case 'PrismLayered':
                params.color = color('layered_diffuse');
                params.roughness = unit('layered_roughness', 0.5);
                unsupported.push('clear coat layer (approximated by the bottom layer)');
                break;
            case 'PrismTransparent':
                params.color = color('transparent_color');
                opacity = transmissionToOpacity(params.color);
                unsupported.push('refraction (approximated by opacity)');
                break;
            case 'PrismGlazing':
                params.color = color('glazing_transmission_color');
                params.roughness = unit('glazing_transmission_roughness', 0);
                opacity = transmissionToOpacity(params.color);
                unsupported.push('glazing transmission (approximated by opacity)');
                break;
            case 'PrismWood':
                params.color = color('wood_early_color');
                unsupported.push('procedural wood (approximated by wood_early_color)');
                break;
            default:
                this.diagnostics.report('unknown-material-type', ctx, {
                    type: m.type, prismType: m.prismType, note: 'unknown PRISM type; exported with a neutral color', raw: m,
                });
                params.color = new THREE.Color(0.8, 0.8, 0.8);
        }
        const maps = Object.entries(m.mapList ?? {}).filter(([, v]) => v != null).map(([k]) => k);
        if (maps.length > 0) {
            unsupported.push(`texture maps (${maps.join(', ')})`);
        }
        if (unsupported.length > 0) {
            this.diagnostics.report('unsupported-material-feature', ctx, { prismType: m.prismType, features: unsupported, raw: m });
        }
        return new THREE.MeshStandardMaterial({ ...params, opacity, transparent: opacity < 1 || m.transparent === true });
    }

    private readColor(get: () => unknown, what: string, ctx: DiagnosticContext, raw: unknown, colorSpace: string = THREE.SRGBColorSpace): THREE.Color {
        const value: any = this.diagnostics.guard(ctx, `Material.get${capitalize(what)}`, get, undefined);
        const out = new THREE.Color(1, 1, 1);
        if (!value || typeof value !== 'object' || ![value.r, value.g, value.b].every(Number.isFinite)) {
            this.diagnostics.report('unexpected-color-value', ctx, { what, value, note: 'white used', raw });
            return out;
        }
        const clamp = (x: number) => Math.min(1, Math.max(0, x));
        if ([value.r, value.g, value.b].some(x => x < 0 || x > 1)) {
            this.diagnostics.report('unexpected-color-value', ctx, {
                what, value: { r: value.r, g: value.g, b: value.b }, note: 'components clamped to [0, 1]', raw,
            });
        }
        // Scene API colors are assumed to be sRGB-encoded (like CSS/hex colors); PRISM colors are linear.
        return out.setRGB(clamp(value.r), clamp(value.g), clamp(value.b), colorSpace as THREE.ColorSpace);
    }

    private readScalar(get: () => unknown, what: string, fallback: number, ctx: DiagnosticContext, raw: unknown): number {
        const value = this.diagnostics.guard(ctx, `Material.get${capitalize(what)}`, get, undefined);
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
            this.diagnostics.report('unexpected-scalar-value', ctx, { what, value, fallback, raw });
            return fallback;
        }
        return value;
    }

    private readUnitScalar(get: () => unknown, what: string, fallback: number, ctx: DiagnosticContext, raw: unknown): number {
        const value = this.readScalar(get, what, fallback, ctx, raw);
        if (value > 1) {
            this.diagnostics.report('unexpected-scalar-value', ctx, { what, value, note: 'clamped to 1', raw });
            return 1;
        }
        return value;
    }

    private readBoolean(get: () => unknown, what: string, fallback: boolean, ctx: DiagnosticContext, raw: unknown): boolean {
        const value = this.diagnostics.guard(ctx, `Material.get${capitalize(what)}`, get, undefined);
        if (typeof value !== 'boolean') {
            this.diagnostics.report('unexpected-scalar-value', ctx, { what, value, fallback, raw });
            return fallback;
        }
        return value;
    }

    private readSide(get: () => unknown, ctx: DiagnosticContext, raw: unknown): THREE.Side {
        const value = this.diagnostics.guard(ctx, 'Material.getSide', get, undefined);
        const Side = (globalThis as any).Autodesk?.Viewing?.Scene?.Side;
        if (Side && value === Side.Front) return THREE.FrontSide;
        if (Side && value === Side.Back) return THREE.BackSide;
        if (Side && value === Side.Double) return THREE.DoubleSide;
        this.diagnostics.report('unexpected-side-value', ctx, {
            value, knownValues: Side ? { ...Side } : 'Autodesk.Viewing.Scene.Side is not defined', note: 'FrontSide used', raw,
        });
        return THREE.FrontSide;
    }

    private readMap(get: () => SceneTexture | null, ctx: DiagnosticContext): THREE.Texture | null {
        if (!this.includeTextures) {
            return null;
        }
        const texture = this.diagnostics.guard(ctx, 'Material.getMap', get, null);
        if (!texture) {
            return null;
        }
        if (this.textures.has(texture)) {
            return this.textures.get(texture)!;
        }
        const converted = this.convertTexture(texture, ctx);
        this.textures.set(texture, converted);
        return converted;
    }

    private convertTexture(texture: SceneTexture, ctx: DiagnosticContext): THREE.Texture | null {
        const d = this.diagnostics;
        const t: any = texture;
        // Internal viewer textures (on legacy materials) have properties instead of getters.
        const legacy = typeof t.getImage !== 'function';
        const get = (getter: string, property: string) => accessor(t, legacy, getter, property);
        const image = d.guard(ctx, 'Texture.getImage', get('getImage', 'image'), undefined);
        const canvas = imageToCanvas(image, d, ctx, texture);
        if (!canvas) {
            return null;
        }
        const result = new THREE.CanvasTexture(canvas);
        result.name = d.guard(ctx, 'Texture.getName', get('getName', 'name'), '') || `texture_${this.textures.size}`;
        result.colorSpace = THREE.SRGBColorSpace;
        result.wrapS = this.readWrap(get('getWrapS', 'wrapS'), 'wrapS', ctx, texture);
        result.wrapT = this.readWrap(get('getWrapT', 'wrapT'), 'wrapT', ctx, texture);
        const repeat = d.guard(ctx, 'Texture.getRepeat', get('getRepeat', 'repeat'), null);
        if (repeat && Number.isFinite(repeat.x) && Number.isFinite(repeat.y)) {
            result.repeat.set(repeat.x, repeat.y);
        }
        const offset = d.guard(ctx, 'Texture.getOffset', get('getOffset', 'offset'), null);
        if (offset && Number.isFinite(offset.x) && Number.isFinite(offset.y)) {
            result.offset.set(offset.x, offset.y);
        }
        return result;
    }

    private readWrap(get: () => unknown, what: string, ctx: DiagnosticContext, raw: unknown): THREE.Wrapping {
        const value = this.diagnostics.guard(ctx, `Texture.get${capitalize(what)}`, get, undefined);
        if (typeof value === 'number' && KNOWN_WRAPPING.has(value)) {
            return value as THREE.Wrapping;
        }
        this.diagnostics.report('unexpected-wrap-value', ctx, { what, value, note: 'RepeatWrapping used', raw });
        return THREE.RepeatWrapping;
    }

    dispose(): void {
        for (const { material } of this.materials.values()) {
            material.dispose();
        }
        for (const texture of this.textures.values()) {
            texture?.dispose();
        }
        this.fallback?.material.dispose();
    }
}

/** Draws any supported image representation into a new canvas. */
function imageToCanvas(image: any, d: Diagnostics, ctx: DiagnosticContext, raw: unknown): HTMLCanvasElement | null {
    if (typeof document === 'undefined') {
        d.report('texture-draw-failed', ctx, { reason: 'no DOM available', raw });
        return null;
    }
    const describe = () => ({
        imageType: image?.constructor?.name ?? typeof image,
        keys: image && typeof image === 'object' ? Object.keys(image) : undefined,
        raw,
    });
    try {
        const canvas = document.createElement('canvas');
        const c2d = canvas.getContext('2d');
        if (!c2d) {
            d.report('texture-draw-failed', ctx, { reason: 'could not create 2D context', ...describe() });
            return null;
        }
        const isDrawable =
            (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) ||
            (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) ||
            (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) ||
            (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) ||
            (typeof HTMLVideoElement !== 'undefined' && image instanceof HTMLVideoElement);
        if (isDrawable) {
            const img: any = image;
            const width = img.naturalWidth || img.videoWidth || img.width;
            const height = img.naturalHeight || img.videoHeight || img.height;
            if (!(width > 0 && height > 0)) {
                d.report('texture-draw-failed', ctx, { reason: `image has no size (${width}x${height}); not loaded yet?`, ...describe() });
                return null;
            }
            canvas.width = width;
            canvas.height = height;
            c2d.drawImage(image, 0, 0);
            return canvas;
        }
        // ImageData or a raw { data, width, height } object (RGBA8).
        if (image && typeof image === 'object' && image.width > 0 && image.height > 0 && image.data?.length) {
            const { width, height, data } = image;
            if (data.length !== width * height * 4 || !(data instanceof Uint8Array || data instanceof Uint8ClampedArray)) {
                d.report('unknown-texture-image-type', ctx, {
                    reason: `raw image data is not RGBA8 (length ${data.length}, ${data.constructor?.name}, ${width}x${height})`,
                    ...describe(),
                });
                return null;
            }
            canvas.width = width;
            canvas.height = height;
            c2d.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
            return canvas;
        }
        d.report('unknown-texture-image-type', ctx, describe());
        return null;
    } catch (err) {
        // For example a tainted (cross-origin) image.
        d.report('texture-draw-failed', ctx, { reason: String(err), error: err, ...describe() });
        return null;
    }
}

/** Rough opacity for transmissive PRISM materials: brighter transmission color means more see-through. */
function transmissionToOpacity(transmission: THREE.Color): number {
    const luminance = 0.2126 * transmission.r + 0.7152 * transmission.g + 0.0722 * transmission.b;
    return Math.min(0.9, Math.max(0.1, 1 - 0.8 * luminance));
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
