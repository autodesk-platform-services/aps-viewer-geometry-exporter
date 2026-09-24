/**
 * Collects reports about unexpected data returned by the Scene API.
 *
 * Every report is recorded, but only the first few of each category are printed
 * to the console (with the raw Scene API object attached so it can be inspected).
 * A summary table is printed at the end of each export.
 */
const LOG_PREFIX = '[GeometryExporter]';
export class Diagnostics {
    entries = [];
    counts = new Map();
    maxLoggedPerCategory;
    silent;
    constructor(options = {}) {
        this.maxLoggedPerCategory = options.maxLoggedPerCategory ?? 5;
        this.silent = options.silent ?? false;
    }
    /**
     * Records an unexpected-data case.
     * @param details Any extra information; `raw` should hold the offending Scene API object.
     */
    report(category, context, details = {}) {
        const count = (this.counts.get(category) ?? 0) + 1;
        this.counts.set(category, count);
        this.entries.push({ category, context, details });
        if (this.silent) {
            return;
        }
        if (count <= this.maxLoggedPerCategory) {
            console.warn(LOG_PREFIX, category, { ...context }, details);
        }
        else if (count === this.maxLoggedPerCategory + 1) {
            console.warn(LOG_PREFIX, category, `more occurrences suppressed; see the summary at the end of the export`);
        }
    }
    /** Runs a Scene API getter and reports (instead of throwing) if it throws. */
    guard(context, what, fn, fallback) {
        try {
            return fn();
        }
        catch (err) {
            this.report('exception', context, { what, error: err });
            return fallback;
        }
    }
    get total() {
        return this.entries.length;
    }
    byCategory(category) {
        return this.entries.filter(e => e.category === category);
    }
    printSummary(stats, format, elapsedMs) {
        if (this.silent) {
            return;
        }
        console.groupCollapsed(`${LOG_PREFIX} ${format.toUpperCase()} export finished in ${(elapsedMs / 1000).toFixed(1)}s with ${this.total} warning(s)`);
        console.table(stats);
        if (this.counts.size > 0) {
            console.table(Object.fromEntries([...this.counts.entries()].map(([k, v]) => [k, { occurrences: v }])));
            console.log(`${LOG_PREFIX} all entries:`, this.entries);
        }
        console.groupEnd();
    }
}
//# sourceMappingURL=diagnostics.js.map