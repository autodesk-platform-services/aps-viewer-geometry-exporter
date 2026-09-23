import * as THREE from 'three';
import type { Diagnostics, DiagnosticContext } from '../diagnostics.ts';

export type PrimitiveMode = 'triangles' | 'lines' | 'points';

type Vec3Like = { x: number; y: number; z: number };

/** Creates a vector the Scene API readers can write into. */
function createReaderTarget(): Autodesk.Viewing.Math.Vector3 {
    const Vector3 = (globalThis as any).Autodesk?.Viewing?.Math?.Vector3;
    if (typeof Vector3 === 'function') {
        return new Vector3();
    }
    // Fallback for environments without the viewer (e.g. unit tests).
    const v: any = { x: 0, y: 0, z: 0 };
    v.set = (x: number, y: number, z: number) => { v.x = x; v.y = y; v.z = z; return v; };
    return v;
}

const NORMAL_LENGTH_TOLERANCE = 0.01;

/**
 * Converts a Scene API geometry into a new, independent THREE.BufferGeometry.
 * Returns null if the geometry can't be used at all; smaller problems are reported
 * to `diagnostics` and repaired or dropped.
 */
export function convertGeometry(
    geom: Autodesk.Viewing.Scene.BufferGeometry,
    mode: PrimitiveMode,
    diagnostics: Diagnostics,
    context: DiagnosticContext
): THREE.BufferGeometry | null {
    const vertexCount = diagnostics.guard(context, 'BufferGeometry.getVertexCount', () => geom.getVertexCount(), 0);
    if (!Number.isInteger(vertexCount) || vertexCount <= 0) {
        diagnostics.report('vertex-count-zero', context, { vertexCount, raw: geom });
        return null;
    }

    const positionReader = diagnostics.guard(context, 'BufferGeometry.getPositionReader', () => geom.getPositionReader(), null);
    if (typeof positionReader !== 'function') {
        diagnostics.report('no-position-reader', context, { reader: positionReader, raw: geom });
        return null;
    }

    const target = createReaderTarget();
    const positions = readVec3(positionReader, vertexCount, target);
    if (positions.nonFinite > 0) {
        diagnostics.report('non-finite-position', context, {
            count: positions.nonFinite, firstIndex: positions.firstNonFinite, vertexCount, raw: geom,
        });
    }

    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.BufferAttribute(positions.data, 3));

    // Normals
    const normals = readNormals(geom, vertexCount, target, diagnostics, context);
    if (normals) {
        if (normals.nonFinite > 0) {
            diagnostics.report('non-finite-normal', context, {
                count: normals.nonFinite, firstIndex: normals.firstNonFinite, vertexCount, raw: geom,
            });
        }
        const nonUnit = normalizeInPlace(normals.data);
        if (nonUnit.count > 0) {
            diagnostics.report('unexpected-scalar-value', context, {
                what: 'normal length != 1 (normalized on export)',
                count: nonUnit.count, firstIndex: nonUnit.firstIndex, firstLength: nonUnit.firstLength, raw: geom,
            });
        }
        result.setAttribute('normal', new THREE.BufferAttribute(normals.data, 3));
    } else if (mode === 'triangles') {
        diagnostics.report('missing-normals', context, { note: 'normals recomputed from triangles', raw: geom });
    }

    // Indices
    const indices = diagnostics.guard(context, 'BufferGeometry.getIndices', () => geom.getIndices(), null);
    const primitiveSize = mode === 'triangles' ? 3 : mode === 'lines' ? 2 : 1;
    let trimAfter = vertexCount;
    if (indices) {
        const cleaned = cleanIndices(indices, vertexCount, primitiveSize, diagnostics, context, geom);
        if (cleaned.length === 0) {
            return null;
        }
        result.setIndex(new THREE.BufferAttribute(cleaned, 1));
    } else if (vertexCount % primitiveSize !== 0) {
        diagnostics.report('vertex-count-not-multiple', context, {
            vertexCount, primitiveSize, mode, note: 'trailing vertices dropped', raw: geom,
        });
        trimAfter = vertexCount - (vertexCount % primitiveSize);
    }

    // Optional attributes
    const uv = readOptionalAttribute(geom, 'uv', [2], vertexCount, diagnostics, context);
    if (uv) {
        result.setAttribute('uv', new THREE.BufferAttribute(uv.data, uv.itemSize));
    }
    const color = readOptionalAttribute(geom, 'color', [3, 4], vertexCount, diagnostics, context);
    if (color) {
        result.setAttribute('color', new THREE.BufferAttribute(color.data, color.itemSize));
    }

    if (trimAfter < vertexCount) {
        for (const [name, attr] of Object.entries(result.attributes)) {
            const a = attr as THREE.BufferAttribute;
            result.setAttribute(name, new THREE.BufferAttribute(a.array.slice(0, trimAfter * a.itemSize), a.itemSize));
        }
        if (trimAfter === 0) {
            return null;
        }
    }

    if (mode === 'triangles' && !result.hasAttribute('normal')) {
        result.computeVertexNormals();
    }
    result.computeBoundingBox();
    result.computeBoundingSphere();
    return result;
}

/**
 * Reads normals through the normal reader. Committed geometry with packed normals has
 * been observed to return no reader (and `getNormal()` returns null), so in that case the
 * attribute is decoded manually and the missing reader is reported.
 */
function readNormals(
    geom: Autodesk.Viewing.Scene.BufferGeometry,
    vertexCount: number,
    target: Vec3Like,
    diagnostics: Diagnostics,
    context: DiagnosticContext
): ReturnType<typeof readVec3> | null {
    const reader = diagnostics.guard(context, 'BufferGeometry.getNormalReader', () => geom.getNormalReader(), null);
    if (typeof reader === 'function') {
        return readVec3(reader, vertexCount, target);
    }
    const hasNormal = diagnostics.guard(context, 'BufferGeometry.hasAttribute', () => geom.hasAttribute('normal'), false);
    if (!hasNormal) {
        return null;
    }
    const attr = diagnostics.guard(context, 'BufferGeometry.getAttribute', () => geom.getAttribute('normal'), null);
    const decoded = decodeAttribute(attr, [2, 3], vertexCount);
    const details = {
        reader,
        getNormal0: diagnostics.guard(context, 'BufferGeometry.getNormal', () => geom.getNormal(0, createReaderTarget()), undefined),
        ...describeAttribute(attr),
        geometryInterleaved: diagnostics.guard(context, 'BufferGeometry.isInterleaved', () => geom.isInterleaved(), undefined),
        geometryCommitted: diagnostics.guard(context, 'BufferGeometry.isCommitted', () => geom.isCommitted(), undefined),
        raw: geom,
    };
    if ('error' in decoded) {
        diagnostics.report('no-normal-reader', context, { ...details, decodedManually: false, reason: decoded.error });
        return null;
    }
    diagnostics.report('no-normal-reader', context, {
        ...details, decodedManually: true, encoding: decoded.itemSize === 2 ? 'spherical (packed)' : 'xyz',
    });
    if (decoded.itemSize === 3) {
        return { data: decoded.data, nonFinite: 0, firstNonFinite: -1 };
    }
    return { data: decodeSphericalNormals(decoded.data), nonFinite: 0, firstNonFinite: -1 };
}

/**
 * Decodes the viewer's packed normal encoding: two components in [0, 1] holding the
 * azimuth (theta = (2u - 1) * PI) and the z coordinate (2v - 1).
 */
export function decodeSphericalNormals(packed: Float32Array): Float32Array<ArrayBuffer> {
    const count = packed.length / 2;
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const theta = (packed[i * 2] * 2 - 1) * Math.PI;
        const z = packed[i * 2 + 1] * 2 - 1;
        const r = Math.sqrt(Math.max(0, 1 - z * z));
        out[i * 3] = Math.cos(theta) * r;
        out[i * 3 + 1] = Math.sin(theta) * r;
        out[i * 3 + 2] = z;
    }
    return out;
}

function readVec3(reader: Autodesk.Viewing.Scene.VertexAttributeReader, count: number, target: Vec3Like) {
    const data = new Float32Array(count * 3);
    let nonFinite = 0;
    let firstNonFinite = -1;
    for (let i = 0; i < count; i++) {
        target.x = target.y = target.z = NaN;
        reader(i, target as Autodesk.Viewing.Math.Vector3);
        let { x, y, z } = target;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            if (nonFinite++ === 0) {
                firstNonFinite = i;
            }
            x = y = z = 0;
        }
        data[i * 3] = x;
        data[i * 3 + 1] = y;
        data[i * 3 + 2] = z;
    }
    return { data, nonFinite, firstNonFinite };
}

/** Normalizes normals in place; zero-length normals are left untouched. */
function normalizeInPlace(data: Float32Array) {
    let count = 0;
    let firstIndex = -1;
    let firstLength = 0;
    for (let i = 0; i < data.length; i += 3) {
        const len = Math.hypot(data[i], data[i + 1], data[i + 2]);
        if (Math.abs(len - 1) > NORMAL_LENGTH_TOLERANCE) {
            if (count++ === 0) {
                firstIndex = i / 3;
                firstLength = len;
            }
            if (len > 0) {
                data[i] /= len;
                data[i + 1] /= len;
                data[i + 2] /= len;
            }
        }
    }
    return { count, firstIndex, firstLength };
}

/**
 * Copies the index buffer, drops primitives referencing vertices out of range, and
 * trims a trailing incomplete primitive.
 */
function cleanIndices(
    indices: ArrayLike<number>,
    vertexCount: number,
    primitiveSize: number,
    diagnostics: Diagnostics,
    context: DiagnosticContext,
    raw: unknown
): Uint32Array {
    let length = indices.length;
    if (length % primitiveSize !== 0) {
        diagnostics.report('index-count-not-multiple', context, {
            indexCount: length, primitiveSize, note: 'trailing indices ignored', raw,
        });
        length -= length % primitiveSize;
    }
    const out = new Uint32Array(length);
    let written = 0;
    let dropped = 0;
    let firstBad = -1;
    for (let i = 0; i < length; i += primitiveSize) {
        let ok = true;
        for (let k = 0; k < primitiveSize; k++) {
            const idx = indices[i + k];
            if (!(idx >= 0 && idx < vertexCount)) {
                ok = false;
                if (firstBad < 0) {
                    firstBad = idx;
                }
            }
        }
        if (ok) {
            for (let k = 0; k < primitiveSize; k++) {
                out[written++] = indices[i + k];
            }
        } else {
            dropped++;
        }
    }
    if (dropped > 0) {
        diagnostics.report('index-out-of-range', context, {
            droppedPrimitives: dropped, firstBadIndex: firstBad, vertexCount, indexCount: indices.length, raw,
        });
    }
    return written === out.length ? out : out.slice(0, written);
}

interface DecodedAttribute {
    data: Float32Array<ArrayBuffer>;
    itemSize: number;
}

function readOptionalAttribute(
    geom: Autodesk.Viewing.Scene.BufferGeometry,
    name: 'uv' | 'color',
    allowedItemSizes: number[],
    vertexCount: number,
    diagnostics: Diagnostics,
    context: DiagnosticContext
): DecodedAttribute | null {
    const has = diagnostics.guard(context, 'BufferGeometry.hasAttribute', () => geom.hasAttribute(name), false);
    if (!has) {
        return null;
    }
    const attr = diagnostics.guard(context, 'BufferGeometry.getAttribute', () => geom.getAttribute(name), null);
    const decoded = decodeAttribute(attr, allowedItemSizes, vertexCount);
    if ('error' in decoded) {
        diagnostics.report(name === 'uv' ? 'uv-undecodable' : 'color-undecodable', context, {
            reason: decoded.error,
            ...describeAttribute(attr),
            geometryInterleaved: diagnostics.guard(context, 'BufferGeometry.isInterleaved', () => geom.isInterleaved(), undefined),
            geometryCommitted: diagnostics.guard(context, 'BufferGeometry.isCommitted', () => geom.isCommitted(), undefined),
            vertexCount,
            raw: geom,
        });
        return null;
    }
    if (decoded.warning) {
        diagnostics.report('unexpected-attribute-layout', context, {
            attribute: name, warning: decoded.warning, ...describeAttribute(attr), vertexCount, raw: geom,
        });
    }
    return decoded;
}

export function describeAttribute(attr: Autodesk.Viewing.Scene.BufferAttribute | null | undefined): Record<string, unknown> {
    if (!attr) {
        return { attribute: attr };
    }
    const safe = <T>(fn: () => T) => { try { return fn(); } catch (e) { return `threw: ${e}`; } };
    return {
        arrayType: attr.array?.constructor?.name,
        arrayLength: attr.array?.length,
        itemSize: attr.itemSize,
        normalized: attr.normalized,
        bytesPerItem: (attr as any).bytesPerItem,
        interleaved: safe(() => attr.isInterleaved?.()),
        offset: safe(() => attr.getOffset?.()),
        stride: safe(() => attr.getStride?.()),
        keys: Object.keys(attr),
    };
}

const INTEGER_NORMALIZERS = new Map<string, number>([
    ['Uint8Array', 255], ['Uint8ClampedArray', 255], ['Int8Array', 127],
    ['Uint16Array', 65535], ['Int16Array', 32767],
    ['Uint32Array', 4294967295], ['Int32Array', 2147483647],
]);

/**
 * Decodes a Scene API BufferAttribute into a tightly packed Float32Array.
 * Supports plain attributes of any typed-array type and interleaved attributes
 * whose stride/offset are expressed in float32 elements (per the AttributeLayout docs),
 * including packed 1- or 2-byte components.
 */
export function decodeAttribute(
    attr: Autodesk.Viewing.Scene.BufferAttribute | null | undefined,
    allowedItemSizes: number[],
    vertexCount: number
): (DecodedAttribute & { warning?: string }) | { error: string } {
    if (!attr) {
        return { error: 'getAttribute() returned no attribute although hasAttribute() is true' };
    }
    const array = attr.array;
    if (!array || typeof array.length !== 'number') {
        return { error: 'attribute has no array' };
    }
    const itemSize = attr.itemSize;
    if (typeof itemSize !== 'number' || !allowedItemSizes.includes(itemSize)) {
        return { error: `unexpected itemSize ${itemSize}, expected ${allowedItemSizes.join(' or ')}` };
    }
    const arrayType = array.constructor?.name ?? 'unknown';
    const out = new Float32Array(vertexCount * itemSize);
    const interleaved = typeof attr.isInterleaved === 'function' ? attr.isInterleaved() : false;
    let warning: string | undefined;

    if (!interleaved) {
        if (array.length < vertexCount * itemSize) {
            return { error: `array too short: ${array.length} < ${vertexCount} * ${itemSize}` };
        }
        if (array.length !== vertexCount * itemSize) {
            warning = `array length ${array.length} != vertexCount * itemSize (${vertexCount * itemSize}); extra data ignored`;
        }
        const divisor = attr.normalized ? INTEGER_NORMALIZERS.get(arrayType) ?? 1 : 1;
        for (let i = 0; i < out.length; i++) {
            out[i] = array[i] / divisor;
        }
    } else {
        const stride = attr.getStride?.();
        const offset = attr.getOffset?.() ?? 0;
        if (typeof stride !== 'number' || stride <= 0 || typeof offset !== 'number' || offset < 0) {
            return { error: `invalid interleaved layout: stride ${stride}, offset ${offset}` };
        }
        const bytesPerItem: number = (attr as any).bytesPerItem ?? 4;
        if (bytesPerItem === 4) {
            if (!(array instanceof Float32Array)) {
                return { error: `interleaved attribute backed by ${arrayType}, expected Float32Array` };
            }
            if ((vertexCount - 1) * stride + offset + itemSize > array.length) {
                return { error: `interleaved buffer too short: length ${array.length}, stride ${stride}, offset ${offset}` };
            }
            for (let v = 0; v < vertexCount; v++) {
                for (let c = 0; c < itemSize; c++) {
                    out[v * itemSize + c] = array[v * stride + offset + c];
                }
            }
        } else if (bytesPerItem === 2 || bytesPerItem === 1) {
            const buffer = array.buffer;
            if (!buffer) {
                return { error: 'packed interleaved attribute without an underlying ArrayBuffer' };
            }
            const view = new DataView(buffer, array.byteOffset ?? 0);
            const bytesPerFloat = 4;
            if (((vertexCount - 1) * stride + offset) * bytesPerFloat + itemSize * bytesPerItem > view.byteLength) {
                return { error: `packed interleaved buffer too short: ${view.byteLength} bytes` };
            }
            const normalizer = attr.normalized === false ? 1 : bytesPerItem === 2 ? 65535 : 255;
            for (let v = 0; v < vertexCount; v++) {
                const base = (v * stride + offset) * bytesPerFloat;
                for (let c = 0; c < itemSize; c++) {
                    const raw = bytesPerItem === 2
                        ? view.getUint16(base + c * 2, true)
                        : view.getUint8(base + c);
                    out[v * itemSize + c] = raw / normalizer;
                }
            }
            warning = `packed ${bytesPerItem}-byte components decoded as unsigned ${attr.normalized === false ? 'integers' : 'normalized integers'}; please verify`;
        } else {
            return { error: `unsupported bytesPerItem ${bytesPerItem}` };
        }
    }

    for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) {
            return { error: `non-finite value at component ${i}` };
        }
    }
    return warning ? { data: out, itemSize, warning } : { data: out, itemSize };
}
