import { validateAttachmentFile, validateImageFile, type UploadFile } from '@bazarhq/shared';

/**
 * Validate an image BEFORE upload (FR-M-13/16: under 2 MB) and produce a
 * downscaled preview data URL. The original byte size is what is validated.
 */
export async function readImageFile(file: File, maxEdge = 900): Promise<{ upload?: UploadFile; error?: string }> {
  const error = validateImageFile(file);
  if (error) return { error };
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
  const previewUrl = await downscale(dataUrl, maxEdge).catch(() => dataUrl);
  return { upload: { name: file.name, size: file.size, type: file.type, previewUrl } };
}

export async function readAttachmentFile(file: File): Promise<{ upload?: UploadFile; error?: string }> {
  const error = validateAttachmentFile(file);
  if (error) return { error };
  return { upload: { name: file.name, size: file.size, type: file.type, previewUrl: '' } };
}

function downscale(src: string, maxEdge: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no canvas'));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.84));
    };
    img.onerror = () => reject(new Error('decode failed'));
    img.src = src;
  });
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
