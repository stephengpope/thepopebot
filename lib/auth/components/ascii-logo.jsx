'use client';

import { useBranding } from 'thepopebot/branding/provider';

const DEFAULT_ASCII = ` _____ _          ____                  ____        _
|_   _| |__   ___|  _ \\ ___  _ __   ___| __ )  ___ | |_
  | | | '_ \\ / _ \\ |_) / _ \\| '_ \\ / _ \\  _ \\ / _ \\| __|
  | | | | | |  __/  __/ (_) | |_) |  __/ |_) | (_) | |_
  |_| |_| |_|\\___|_|   \\___/| .__/ \\___|____/ \\___/ \\__|
                            |_|`;

export function AsciiLogo() {
  const { hasCustomLogo, productName } = useBranding();

  if (hasCustomLogo) {
    return (
      <img
        src="/branding/logo"
        alt={productName}
        className="mb-8 max-h-24 w-auto select-none"
      />
    );
  }

  return (
    <pre className="text-foreground text-[clamp(0.45rem,1.5vw,0.85rem)] leading-snug text-left mb-8 select-none">
      {DEFAULT_ASCII}
    </pre>
  );
}
