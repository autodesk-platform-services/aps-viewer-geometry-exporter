export interface InspectReport {
    model: string;
    instanceCount: unknown;
    objectTreeInstanceCount?: number;
    objectTreeInstanceIdRange?: [number, number];
    samples: Record<string, unknown>[];
}
/**
 * Logs the raw shape of the data the Scene API returns for the first few instances of
 * each model: attribute layouts, material classes, texture image types, transforms.
 * Meant for troubleshooting and for sharing with the Scene API team.
 */
export declare function inspectModels(models: Autodesk.Viewing.Model[], sampleCount?: number): Promise<InspectReport[]>;
