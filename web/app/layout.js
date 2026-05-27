import './globals.css';
import { ThemeProvider } from 'thepopebot/chat';
import { BrandingProvider } from 'thepopebot/branding/provider';
import { getBranding } from 'thepopebot/branding/config';

export function generateMetadata() {
  const { productName, hasCustomFavicon } = getBranding();
  return {
    title: productName,
    description: 'AI Agent',
    ...(hasCustomFavicon
      ? { icons: { icon: '/branding/favicon' } }
      : {}),
  };
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  const branding = getBranding();
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-svh bg-background text-foreground antialiased">
        <BrandingProvider value={branding}>
          <ThemeProvider>{children}</ThemeProvider>
        </BrandingProvider>
      </body>
    </html>
  );
}
