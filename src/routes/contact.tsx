import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, Mail, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Section, SiteShell } from "@/components/marketing/site-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact HermesPass — Book an Agent Governance Briefing" },
      {
        name: "description",
        content:
          "Request a 30-minute HermesPass briefing: agent passport issuance, policy gateway, scoped spend limits and regulator-ready audit exports.",
      },
      {
        property: "og:title",
        content: "Contact HermesPass — Book a Briefing",
      },
      {
        property: "og:description",
        content:
          "Tell us about your agent estate and we'll map it onto HermesPass controls in one session.",
      },
    ],
  }),
  component: ContactPage,
});

type Form = {
  name: string;
  email: string;
  company: string;
  region: string;
  estate: string;
  message: string;
};

const EMPTY: Form = {
  name: "",
  email: "",
  company: "",
  region: "",
  estate: "",
  message: "",
};

function ContactPage() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [sent, setSent] = useState(false);

  const set = (key: keyof Form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Partial<Record<keyof Form, string>> = {};
    if (!form.name.trim()) next.name = "Please enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      next.email = "Enter a valid work email address.";
    if (!form.company.trim()) next.company = "Please enter your company.";
    if (!form.region) next.region = "Select a region.";
    if (form.message.trim().length < 10)
      next.message = "Add a little more detail (10+ characters).";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSent(true);
    toast.success("Briefing request received", {
      description: "We'll reply within one business day.",
    });
  }

  return (
    <SiteShell>
      <Section className="grid-backdrop">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="font-mono text-[11px] tracking-[0.22em] text-emerald-accent uppercase">
              Contact
            </p>
            <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">
              Book an agent governance briefing
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Thirty minutes, technical, no slides required. Bring one agent
              workflow and we'll walk through passport issuance, the policy
              decision it would receive, the spend limits it needs and the audit
              evidence it produces.
            </p>

            <ul className="mt-8 space-y-4">
              <li className="flex gap-3 text-sm">
                <Mail className="mt-0.5 size-4 text-cyan-accent" />
                <span className="text-muted-foreground">
                  hello@hermespass.asia
                </span>
              </li>
              <li className="flex gap-3 text-sm">
                <MapPin className="mt-0.5 size-4 text-cyan-accent" />
                <span className="text-muted-foreground">
                  Hong Kong SAR · Singapore
                </span>
              </li>
            </ul>

            <div className="panel mt-8 p-5">
              <p className="text-sm font-semibold">What happens next</p>
              <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>1. We reply within one business day.</li>
                <li>2. Short discovery call on your agent estate.</li>
                <li>3. Briefing with a walkthrough on your use case.</li>
              </ol>
            </div>
          </div>

          {sent ? (
            <div className="panel flex flex-col items-start justify-center p-8">
              <CheckCircle2 className="size-8 text-emerald-accent" />
              <h2 className="mt-4 text-xl font-semibold">
                Thanks, {form.name.split(" ")[0]}.
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Your briefing request is in. We'll follow up at {form.email}{" "}
                within one business day.
              </p>
              <Button
                variant="outline"
                className="mt-6"
                onClick={() => {
                  setForm(EMPTY);
                  setSent(false);
                }}
              >
                Send another request
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="panel space-y-5 p-6 sm:p-8">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  id="name"
                  label="Full name"
                  value={form.name}
                  onChange={set("name")}
                  error={errors.name}
                  placeholder="Alex Chan"
                />
                <Field
                  id="email"
                  label="Work email"
                  type="email"
                  value={form.email}
                  onChange={set("email")}
                  error={errors.email}
                  placeholder="alex@company.com"
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  id="company"
                  label="Company"
                  value={form.company}
                  onChange={set("company")}
                  error={errors.company}
                  placeholder="Company Ltd"
                />
                <div className="space-y-2">
                  <Label htmlFor="region">Region</Label>
                  <Select value={form.region} onValueChange={set("region")}>
                    <SelectTrigger id="region">
                      <SelectValue placeholder="Select region" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hk">Hong Kong SAR</SelectItem>
                      <SelectItem value="sg">Singapore</SelectItem>
                      <SelectItem value="apac">Rest of APAC</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.region ? (
                    <p className="text-xs text-risk-high">{errors.region}</p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="estate">Agents in production or planned</Label>
                <Select value={form.estate} onValueChange={set("estate")}>
                  <SelectTrigger id="estate">
                    <SelectValue placeholder="Optional" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0-5">Exploring · under 5</SelectItem>
                    <SelectItem value="5-25">5 to 25</SelectItem>
                    <SelectItem value="25-100">25 to 100</SelectItem>
                    <SelectItem value="100+">100+</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="message">
                  What are your agents doing today?
                </Label>
                <Textarea
                  id="message"
                  rows={5}
                  value={form.message}
                  onChange={(e) => set("message")(e.target.value)}
                  placeholder="e.g. procurement agents raising POs up to HKD 50,000 against three vendors"
                />
                {errors.message ? (
                  <p className="text-xs text-risk-high">{errors.message}</p>
                ) : null}
              </div>

              <Button type="submit" className="w-full sm:w-auto">
                Request briefing
              </Button>
              <p className="text-xs text-muted-foreground">
                We use your details only to respond to this request.
              </p>
            </form>
          )}
        </div>
      </Section>
    </SiteShell>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  placeholder,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  placeholder?: string | undefined;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? <p className="text-xs text-risk-high">{error}</p> : null}
    </div>
  );
}
