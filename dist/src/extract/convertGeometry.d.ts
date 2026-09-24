import * as THREE from 'three';
import type { Diagnostics, DiagnosticContext } from '../diagnostics.ts';
export type PrimitiveMode = 'triangles' | 'lines' | 'points';
/**
 * Converts a Scene API geometry into a new, independent THREE.BufferGeometry.
 * Returns null if the geometry can't be used at all; smaller problems are reported
 * to `diagnostics` and repaired or dropped.
 */
export declare function convertGeometry(geom: Autodesk.Viewing.Scene.BufferGeometry, mode: PrimitiveMode, diagnostics: Diagnostics, context: DiagnosticContext): THREE.BufferGeometry | null;
/**
 * Decodes the viewer's packed normal encoding: two components in [0, 1] holding the
 * azimuth (theta = (2u - 1) * PI) and the z coordinate (2v - 1).
 */
export declare function decodeSphericalNormals(packed: Float32Array): Float32Array<ArrayBuffer>;
interface DecodedAttribute {
    data: Float32Array<ArrayBuffer>;
    itemSize: number;
}
export declare function describeAttribute(attr: Autodesk.Viewing.Scene.BufferAttribute | null | undefined): Record<string, unknown>;
/**
 * Decodes a Scene API BufferAttribute into a tightly packed Float32Array.
 * Supports plain attributes of any typed-array type and interleaved attributes
 * whose stride/offset are expressed in float32 elements (per the AttributeLayout docs),
 * including packed 1- or 2-byte components.
 */
export declare function decodeAttribute(attr: Autodesk.Viewing.Scene.BufferAttribute | null | undefined, allowedItemSizes: number[], vertexCount: number): (DecodedAttribute & {
    warning?: string;
}) | {
    error: string;
};
export {};
