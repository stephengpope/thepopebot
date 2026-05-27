"use client";
import { jsx } from "react/jsx-runtime";
import { useBranding } from "thepopebot/branding/provider";
const DEFAULT_ASCII = ` _____ _          ____                  ____        _
|_   _| |__   ___|  _ \\ ___  _ __   ___| __ )  ___ | |_
  | | | '_ \\ / _ \\ |_) / _ \\| '_ \\ / _ \\  _ \\ / _ \\| __|
  | | | | | |  __/  __/ (_) | |_) |  __/ |_) | (_) | |_
  |_| |_| |_|\\___|_|   \\___/| .__/ \\___|____/ \\___/ \\__|
                            |_|`;
function AsciiLogo() {
  const { hasCustomLogo, productName } = useBranding();
  if (hasCustomLogo) {
    return /* @__PURE__ */ jsx(
      "img",
      {
        src: "/branding/logo",
        alt: productName,
        className: "mb-8 max-h-24 w-auto select-none"
      }
    );
  }
  return /* @__PURE__ */ jsx("pre", { className: "text-foreground text-[clamp(0.45rem,1.5vw,0.85rem)] leading-snug text-left mb-8 select-none", children: DEFAULT_ASCII });
}
export {
  AsciiLogo
};
