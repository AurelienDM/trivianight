/** Compress a camera frame / gallery File into a small JPEG data URL for team avatars. */

const MAX_EDGE = 320;

function drawToDataUrl(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  maxEdge: number,
  quality: number,
): string {
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process image');
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Live getUserMedia only works in a secure context (https or localhost).
 * LAN game nights use http://192.168.x.x — browsers block the camera API there.
 */
export function canUseLiveCamera(): boolean {
  if (typeof window === 'undefined') return false;
  return !!window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
}

/** Compress a File (native camera / photo picker) into a small JPEG data URL. */
export async function compressImageFile(file: File): Promise<string> {
  return fileToAvatarDataUrl(file);
}

export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/') && file.type !== '') {
    throw new Error('Please choose an image');
  }
  const bitmap = await createImageBitmap(file);
  try {
    let dataUrl = drawToDataUrl(bitmap, bitmap.width, bitmap.height, MAX_EDGE, 0.72);
    if (dataUrl.length > 220_000) {
      dataUrl = drawToDataUrl(bitmap, bitmap.width, bitmap.height, 220, 0.55);
    }
    return dataUrl;
  } finally {
    bitmap.close();
  }
}

/** Capture current video frame as avatar data URL. */
export function videoToAvatarDataUrl(video: HTMLVideoElement): string {
  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  let dataUrl = drawToDataUrl(video, w, h, MAX_EDGE, 0.72);
  if (dataUrl.length > 220_000) {
    dataUrl = drawToDataUrl(video, w, h, 220, 0.55);
  }
  return dataUrl;
}

export async function openSelfieStream(): Promise<MediaStream> {
  if (!canUseLiveCamera()) {
    throw new Error('Live camera needs https or localhost — use Take a picture instead');
  }
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
    audio: false,
  });
}

export function stopStream(stream: MediaStream | null | undefined) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}
