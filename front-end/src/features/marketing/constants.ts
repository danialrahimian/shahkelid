import {
  EyeOff,
  Globe2,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * The copy the landing page is built from.
 *
 * Kept apart from the components so a wording change is a one-line edit and
 * does not risk disturbing the layout or the animation around it.
 */

export const SERVERS = [
  "Germany",
  "Netherlands",
  "USA",
  "Japan",
  "France",
  "UK",
  "Canada",
  "Singapore",
  "UAE",
  "Turkey",
  "Finland",
  "South Korea",
];

export type Stat = {
  label: string;
  value?: number;
  decimals?: number;
  suffix?: string;
  text?: string;
};

export const STATS: Stat[] = [
  { value: 80, suffix: "+", label: "Active servers" },
  { value: 250, suffix: "K+", label: "Happy users" },
  { value: 99.9, decimals: 1, suffix: "%", label: "Uptime" },
  { text: "24/7", label: "Support" },
];

export const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Zap,
    title: "Lightning speed",
    desc: "Next-gen protocols mean no throttling, even streaming in 4K or downloading large files.",
  },
  {
    icon: ShieldCheck,
    title: "Military-grade encryption",
    desc: "Every byte of traffic is protected with AES-256 — the same standard banks rely on.",
  },
  {
    icon: EyeOff,
    title: "Zero-log policy",
    desc: "We never store your activity, IP address, or traffic. Nothing to hand over, ever.",
  },
  {
    icon: Globe2,
    title: "Global access",
    desc: "80+ servers across 50 countries for a smooth connection, wherever you are.",
  },
];

export const FAQS = [
  {
    q: "Is Shah Kelid actually secure?",
    a: "Yes. All traffic is protected with AES-256 encryption, and we keep zero logs of your activity, IP, or destinations.",
  },
  {
    q: "How many devices can I use at once?",
    a: "Between 2 and unlimited, depending on your plan. Full breakdown is in the pricing table above.",
  },
  {
    q: "What if my speed drops?",
    a: "Switch servers with one tap in the app, or reach our 24/7 support and we'll tune the best server for you.",
  },
  {
    q: "Can I get a refund?",
    a: "The yearly plan includes a full, no-questions-asked refund within 30 days of purchase.",
  },
  {
    q: "Which platforms are supported?",
    a: "Windows, macOS, Android, iOS, and routers — one account works across all of your devices.",
  },
];
