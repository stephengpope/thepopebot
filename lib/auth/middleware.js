import NextAuth from 'next-auth';
import { authConfig } from './edge-config.js';
import { NextResponse } from 'next/server';

const { auth } = NextAuth(authConfig);

export const middleware = auth((req) => {
  const { pathname } = req.nextUrl;

  // API routes use their own centralized auth (checkAuth in api/index.js)
  if (pathname.startsWith('/api')) return;

  // Branding assets (logo, favicon) — public, no auth required so they
  // render on the login page itself.
  if (pathname.startsWith('/branding/')) return;

  // Static assets from public/ — skip auth for common file extensions
  if (/\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|ttf|eot|mp4|webm)$/i.test(pathname)) {
    return;
  }

  // /login is an unprotected page (login, first-user setup)
  if (pathname === '/login') {
    if (req.auth) return NextResponse.redirect(new URL('/', req.url));
    return;
  }

  // Everything else requires auth
  if (!req.auth) {
    const response = NextResponse.redirect(new URL('/login', req.url));

    // Clear stale session cookies that can't be decrypted (e.g. after AUTH_SECRET rotation
    // or container restart). Auth.js clears these internally in route handlers via
    // sessionStore.clean(), but NOT in middleware — so the bad cookie loops forever.
    // Only session-token cookies are cleared; csrf-token and callback-url are left intact.
    const cookieNames = Object.keys(req.cookies.getAll().reduce((acc, c) => { acc[c.name] = true; return acc; }, {}));
    const staleSessionCookies = cookieNames.filter(name =>
      name === 'authjs.session-token' ||
      name === '__Secure-authjs.session-token' ||
      /^authjs\.session-token\.\d+$/.test(name) ||
      /^__Secure-authjs\.session-token\.\d+$/.test(name)
    );

    if (staleSessionCookies.length > 0) {
      for (const name of staleSessionCookies) {
        response.cookies.set(name, '', { maxAge: 0, path: '/' });
      }
    }

    return response;
  }

  // Admin panel requires admin role (after auth check above)
  if (pathname.startsWith('/admin') && req.auth?.user?.role !== 'admin') {
    return NextResponse.redirect(new URL('/forbidden', req.url));
  }
});

export const config = {
  // Exclude all _next internal paths (static chunks, HMR, images, Turbopack dev assets)
  matcher: ['/((?!_next|favicon.ico).*)'],
};
