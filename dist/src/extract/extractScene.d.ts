import * as THREE from 'three';
import type { Diagnostics, ExportStats } from '../diagnostics.ts';
export interface ExtractOptions {
    /** Rotate the Z-up viewer world so that Y is up (glTF and USD convention). */
    yUp: boolean;
    /** Scale each model from its native units to meters. */
    toMeters: boolean;
    /** Translate the result so that its bounding box is centered at the origin. */
    recenter: boolean;
    /** Export diffuse texture maps. */
    includeTextures: boolean;
}
export declare const DEFAULT_EXTRACT_OPTIONS: ExtractOptions;
export interface ExtractProgress {
    model: number;
    models: number;
    instance: number;
    instances: number;
}
export interface ExtractResult {
    scene: THREE.Scene;
    stats: ExportStats;
    /** Releases all three.js resources created for the export. */
    dispose(): void;
}
export interface ExtractParams {
    models: Autodesk.Viewing.Model[];
    options?: Partial<ExtractOptions>;
    diagnostics: Diagnostics;
    onProgress?: (progress: ExtractProgress) => void;
    signal?: AbortSignal;
}
export declare function describeModel(model: Autodesk.Viewing.Model, index: number): string;
/**
 * Reads all instances of the given models through the Scene API and builds an
 * equivalent THREE.Scene. Geometries, materials and textures shared between instances
 * stay shared in the result.
 */
export declare function extractScene(params: ExtractParams): Promise<ExtractResult>;
