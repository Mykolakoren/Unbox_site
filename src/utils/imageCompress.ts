/**
 * Client-side image compression for uploads.
 *
 * Why: phone photos as PNG run 2-8 MB and blow past the 2 MB upload cap.
 * Specialists shouldn't have to think about file format or size — we
 * downscale to a sane max dimension and re-encode as JPEG before the
 * file ever leaves the browser. A 896×1094 PNG (2.3 MB) becomes a
 * ~100 KB JPEG with no visible quality loss for a profile photo.
 *
 * Falls back to the original File if anything goes wrong (e.g. the
 * browser can't decode HEIC into a <canvas> — Chrome can't, Safari can).
 * The server-side 2 MB guard still catches whatever slips through.
 */
export async function compressImage(
    file: File,
    maxDim = 1600,
    quality = 0.85,
): Promise<File> {
    if (!file.type.startsWith('image/')) return file;

    try {
        const dataUrl = await readAsDataURL(file);
        const img = await loadImage(dataUrl);

        let { width, height } = img;
        if (width <= 0 || height <= 0) return file;
        if (width > maxDim || height > maxDim) {
            const scale = maxDim / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return file;
        ctx.drawImage(img, 0, 0, width, height);

        const blob = await new Promise<Blob | null>(resolve =>
            canvas.toBlob(resolve, 'image/jpeg', quality),
        );
        if (!blob) return file;

        // If compression somehow made it bigger (tiny already-optimised
        // images), keep the original.
        if (blob.size >= file.size) return file;

        const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
        return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
    } catch {
        return file;
    }
}

function readAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(new Error('read failed'));
        r.readAsDataURL(file);
    });
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('decode failed'));
        img.src = src;
    });
}
