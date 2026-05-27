"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./ui/card";
import { useBranding } from "thepopebot/branding/provider";
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { productTagline } = useBranding();
  const justCreated = searchParams.get("created") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false
      });
      if (result?.error) {
        setError("Invalid email or password.");
      } else {
        router.push("/");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }
  return /* @__PURE__ */ jsxs("div", { className: "w-full max-w-sm space-y-3", children: [
    justCreated && /* @__PURE__ */ jsx("div", { className: "rounded-lg border border-green-500/30 bg-green-500/5 p-4", children: /* @__PURE__ */ jsx("p", { className: "text-sm font-medium text-green-500", children: "Account created. Sign in with your new credentials." }) }),
    /* @__PURE__ */ jsxs(Card, { className: "w-full max-w-sm", children: [
      /* @__PURE__ */ jsxs(CardHeader, { children: [
        /* @__PURE__ */ jsx(CardTitle, { children: "Sign In" }),
        /* @__PURE__ */ jsx(CardDescription, { children: productTagline })
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
              value: password,
              onChange: (e) => setPassword(e.target.value),
              required: true
            }
          )
        ] }),
        error && /* @__PURE__ */ jsx("p", { className: "text-sm text-destructive", children: error }),
        /* @__PURE__ */ jsx(Button, { type: "submit", className: "w-full", disabled: loading, children: loading ? "Signing in..." : "Sign In" })
      ] }) })
    ] })
  ] });
}
export {
  LoginForm
};
