"use client";
import { jsx } from "react/jsx-runtime";
import { createContext, useContext } from "react";
const BrandingContext = createContext({
  productName: "ThePopeBot",
  productTagline: "Log in to your agent dashboard.",
  setupTagline: "Set up your first admin account to get started.",
  attributionText: "",
  attributionUrl: "",
  hasCustomLogo: false,
  hasCustomFavicon: false
});
function BrandingProvider({ value, children }) {
  return /* @__PURE__ */ jsx(BrandingContext.Provider, { value, children });
}
function useBranding() {
  return useContext(BrandingContext);
}
export {
  BrandingProvider,
  useBranding
};
