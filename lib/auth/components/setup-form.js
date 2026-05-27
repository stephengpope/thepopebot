"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./ui/card";
import { setupAdmin } from "../actions.js";
import { useBranding } from "thepopebot/branding/provider";
function SetupForm() {
  const router = useRouter();
  const { setupTagline } = useBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await setupAdmin(email, password);
      if (result.error) {
        setError(result.error);
        setLoading(false);
        return;
      }
      setCreated(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }
  async function handleSignup() {
    setSigningUp(true);
    try {
      await fetch("https://app.convertkit.com/forms/9126548/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "email_address=" + encodeURIComponent(email),
        redirect: "manual"
      });
    } catch {
    }
    router.push("/login?created=1");
  }
  if (created) {
    return /* @__PURE__ */ jsxs("div", { className: "w-full max-w-sm space-y-3", children: [
      /* @__PURE__ */ jsx("div", { className: "rounded-lg border border-green-500/30 bg-green-500/5 p-4", children: /* @__PURE__ */ jsx("p", { className: "text-sm font-medium text-green-500", children: "Account created. Sign in with your new credentials." }) }),
      /* @__PURE__ */ jsxs(Card, { className: "w-full max-w-sm", children: [
        /* @__PURE__ */ jsx(CardHeader, { children: /* @__PURE__ */ jsx(CardTitle, { children: "Get urgent updates and features" }) }),
        /* @__PURE__ */ jsxs(CardContent, { className: "space-y-4", children: [
          /* @__PURE__ */ jsxs("div", { className: "space-y-2", children: [
            /* @__PURE__ */ jsx(Label, { children: "Email" }),
            /* @__PURE__ */ jsx(Input, { type: "email", value: email, onChange: (e) => setEmail(e.target.value) })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: handleSignup,
                disabled: signingUp,
                className: "px-3 py-1.5 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors",
                children: signingUp ? "Signing up..." : "Sign Up"
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: () => router.push("/login?created=1"),
                disabled: signingUp,
                className: "px-3 py-1.5 text-sm font-medium rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors",
                children: "Not Now"
              }
            )
          ] })
        ] })
      ] })
    ] });
  }
  return /* @__PURE__ */ jsxs(Card, { className: "w-full max-w-sm", children: [
    /* @__PURE__ */ jsxs(CardHeader, { children: [
      /* @__PURE__ */ jsx(CardTitle, { children: "Create Admin Account" }),
      /* @__PURE__ */ jsx(CardDescription, { children: setupTagline })
    ] }),
    /* @__PURE__ */ jsx(CardContent, { children: /* @__PURE__ */ jsxs("form", { onSubmit: handleSubmit, className: "space-y-4", children: [
      /* @__PURE__ */ jsxs("div", { className: "space-y-2", children: [
        /* @__PURE__ */ jsx(Label, { htmlFor: "email", children: "Email" }),
        /* @__PURE__ */ jsx(
          Input,
          {
            id: "email",
            type: "email",
            placeholder: "admin@example.com",
            value: email,
            onChange: (e) => setEmail(e.target.value),
            required: true
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "space-y-2", children: [
        /* @__PURE__ */ jsx(Label, { htmlFor: "password", children: "Password" }),
        /* @__PURE__ */ jsx(
          Input,
          {
            id: "password",
            type: "password",
            placeholder: "Min 8 characters",
            value: password,
            onChange: (e) => setPassword(e.target.value),
            required: true,
            minLength: 8
          }
        )
      ] }),
      error && /* @__PURE__ */ jsx("p", { className: "text-sm text-destructive", children: error }),
      /* @__PURE__ */ jsx(Button, { type: "submit", className: "w-full", disabled: loading, children: loading ? "Creating..." : "Create Account" })
    ] }) })
  ] });
}
export {
  SetupForm
};
