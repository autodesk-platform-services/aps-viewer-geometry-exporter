/** Triggers a browser download of `blob` as `filename`. */
export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Give the browser a moment to start the download before revoking the URL.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
/** Turns an arbitrary model name into a safe file name stem. */
export function sanitizeFileName(name) {
    const cleaned = name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^a-z0-9_\-. ]+/gi, '_').trim();
    return cleaned.slice(0, 100) || 'model';
}
//# sourceMappingURL=download.js.map