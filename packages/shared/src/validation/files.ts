import { LIMITS } from '../constants';

/* ------------------------------ Images ------------------------------ */

export function validateImageFile(file: { size: number; type: string }): string | null {
  if (!LIMITS.imageMimeTypes.includes(file.type)) return 'Use a JPG, PNG or WebP image.';
  if (file.size > LIMITS.imageMaxBytes) return 'Image must be under 2 MB';
  return null;
}

export function validateAttachmentFile(file: { size: number; type: string }): string | null {
  if (!LIMITS.attachmentMimeTypes.includes(file.type)) return 'Attach a JPG, PNG or PDF file.';
  if (file.size > LIMITS.attachmentMaxBytes) return 'Attachment must be under 5 MB';
  return null;
}
