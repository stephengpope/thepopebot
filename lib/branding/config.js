/**
 * Branding configuration — read at request time from env vars and the filesystem.
 *
 * All values are optional. When unset, defaults preserve the existing ThePopeBot
 * look so this is a backwards-compatible additive change.
 *
 * Server-side only. Client components receive these values via BrandingProvider.
 */

import { existsSync } from 'fs';
import { join } from 'path';

const DEFAULTS = {
  productName: 'ThePopeBot',
  productTagline: 'Log in to your agent dashboard.',
  setupTagline: 'Set up your first admin account to get started.',
  attributionText: '',
  attributionUrl: '',
};

const BRANDING_DIR = process.env.BRANDING_DIR || '/app/branding';

/**
 * @returns {{
 *   productName: string,
 *   productTagline: string,
 *   setupTagline: string,
 *   attributionText: string,
 *   attributionUrl: string,
 *   hasCustomLogo: boolean,
 *   hasCustomFavicon: boolean,
 *   brandingDir: string,
 * }}
 */
export function getBranding() {
  return {
    productName: process.env.PRODUCT_NAME || DEFAULTS.productName,
    productTagline: process.env.PRODUCT_TAGLINE || DEFAULTS.productTagline,
    setupTagline: process.env.SETUP_TAGLINE || DEFAULTS.setupTagline,
    attributionText: process.env.ATTRIBUTION_TEXT || DEFAULTS.attributionText,
    attributionUrl: process.env.ATTRIBUTION_URL || DEFAULTS.attributionUrl,
    hasCustomLogo: hasLogoFile(),
    hasCustomFavicon: hasFaviconFile(),
    brandingDir: BRANDING_DIR,
  };
}

function hasLogoFile() {
  return (
    existsSync(join(BRANDING_DIR, 'logo.svg')) ||
    existsSync(join(BRANDING_DIR, 'logo.png')) ||
    existsSync(join(BRANDING_DIR, 'logo.jpg'))
  );
}

function hasFaviconFile() {
  return (
    existsSync(join(BRANDING_DIR, 'favicon.svg')) ||
    existsSync(join(BRANDING_DIR, 'favicon.ico')) ||
    existsSync(join(BRANDING_DIR, 'favicon.png'))
  );
}

/**
 * Resolve the actual filename for the logo (returns the first extension that exists).
 * Used by the /branding/[asset] route to find the right file.
 * @param {string} asset - e.g. 'logo' or 'favicon'
 * @returns {string|null} - absolute path, or null if no matching file
 */
export function resolveBrandingAsset(asset) {
  const safe = String(asset || '').replace(/[^a-z0-9.-]/gi, '');
  if (!safe || safe.startsWith('.') || safe.includes('..')) return null;

  // If extension is explicit (e.g. 'logo.svg'), serve that exact file
  if (safe.includes('.')) {
    const path = join(BRANDING_DIR, safe);
    return existsSync(path) ? path : null;
  }

  // No extension: try common ones in priority order
  const extensions = ['svg', 'png', 'ico', 'jpg', 'jpeg'];
  for (const ext of extensions) {
    const path = join(BRANDING_DIR, `${safe}.${ext}`);
    if (existsSync(path)) return path;
  }
  return null;
}
