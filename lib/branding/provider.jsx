'use client';

import { createContext, useContext } from 'react';

const BrandingContext = createContext({
  productName: 'ThePopeBot',
  productTagline: 'Log in to your agent dashboard.',
  setupTagline: 'Set up your first admin account to get started.',
  attributionText: '',
  attributionUrl: '',
  hasCustomLogo: false,
  hasCustomFavicon: false,
});

/**
 * Wraps the app and provides branding values to all client components.
 * Initial values are computed server-side and passed in.
 */
export function BrandingProvider({ value, children }) {
  return (
    <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
  );
}

/**
 * Hook to access branding values from any client component.
 */
export function useBranding() {
  return useContext(BrandingContext);
}
