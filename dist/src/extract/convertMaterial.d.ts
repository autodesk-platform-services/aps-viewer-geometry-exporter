import * as THREE from 'three';
import type { Diagnostics, DiagnosticContext } from '../diagnostics.ts';
import type { PrimitiveMode } from './convertGeometry.ts';
type SceneMaterial = Autodesk.Viewing.Scene.Material;
export type MaterialKind = 'standard' | 'unlit' | 'line' | 'points' | 'unknown';
export interface ConvertedMaterial {
    material: THREE.Material;
    mode: PrimitiveMode;
    kind: MaterialKind;
}
export interface MaterialClassification {
    kind: MaterialKind;
    /** True for internal viewer materials that don't implement the Scene API getters. */
    legacy: boolean;
    /** True for internal PRISM materials (e.g. Fusion and Inventor models). */
    prism?: boolean;
}
/** Identifies the Scene API material class (or the internal viewer material type) of `material`. */
export declare function classifyMaterialSource(material: unknown): MaterialClassification;
export declare function classifyMaterial(material: unknown): MaterialKind;
/** Rough Blinn-Phong exponent → GGX roughness conversion. */
export declare function specularPowerToRoughness(power: number): number;
/**
 * Converts Scene API materials and textures into three.js ones. Results are cached per
 * source object so that shared materials stay shared in the export.
 */
export declare class MaterialConverter {
    readonly materials: Map<Autodesk.Viewing.Scene.Material, ConvertedMaterial>;
    readonly textures: Map<Autodesk.Viewing.Scene.Texture, THREE.Texture<unknown, THREE.TextureEventMap> | null>;
    private fallback;
    private readonly diagnostics;
    private readonly includeTextures;
    constructor(diagnostics: Diagnostics, options: {
        includeTextures: boolean;
    });
    /** Material used for instances without a (recognizable) material. */
    getFallback(): ConvertedMaterial;
    convert(material: SceneMaterial | null, context: DiagnosticContext): ConvertedMaterial;
    private convertUncached;
    /**
     * Approximates an internal PRISM material (see the viewer's MaterialConverterPrism) with a
     * standard PBR material. PRISM colors are stored in linear space.
     */
    private convertPrism;
    private readColor;
    private readScalar;
    private readUnitScalar;
    private readBoolean;
    private readSide;
    private readMap;
    private convertTexture;
    private readWrap;
    dispose(): void;
}
export {};
