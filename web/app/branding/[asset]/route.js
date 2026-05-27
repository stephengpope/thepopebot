import { readFile } from 'fs/promises';
import { extname } from 'path';
import { resolveBrandingAsset } from 'thepopebot/branding/config';

const CONTENT_TYPES = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.css': 'text/css',
};

/**
 * GET /branding/:asset
 *
 * Serves files from the BRANDING_DIR (default /app/branding). Used to deliver
 * the install's custom logo, favicon, and CSS overrides without baking them
 * into the upstream image.
 *
 * Path traversal is prevented: only basenames matching [a-z0-9.-]+ are accepted.
 */
export async function GET(request, { params }) {
  const { asset } = await params;
  const resolved = resolveBrandingAsset(asset);
  if (!resolved) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const data = await readFile(resolved);
    const contentType = CONTENT_TYPES[extname(resolved).toLowerCase()] || 'application/octet-stream';
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
