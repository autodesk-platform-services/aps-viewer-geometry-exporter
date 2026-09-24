import * as THREE from 'three';
import type { Diagnostics } from '../diagnostics.ts';
export declare const USDZ_MIME_TYPE = "model/vnd.usdz+zip";
/**
 * Serializes a three.js scene into a USDZ file.
 *
 * USDZExporter only supports meshes with (physically based) standard materials, so the
 * scene is adjusted in place first:
 * - unlit materials are replaced by standard materials that emit their color,
 * - line and point objects are removed (and reported).
 */
export declare function writeUsdz(scene: THREE.Scene, diagnostics: Diagnostics): Promise<Blob>;
export declare function prepareForUsdz(scene: THREE.Scene, diagnostics: Diagnostics): void;
