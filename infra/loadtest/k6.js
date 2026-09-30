// The load test (k6). Two kinds of traffic at once, at a size a shop of
// 10,000 customers sees on a bad day:
//
//   visitors   people on the site: home, plans, the journal, a post, the
//              pricing page. Ramps to 300 at once.
//   vpn apps   customers' apps refreshing their subscription link. 10,000
//              apps refreshing every few hours is about one a second; this
//              sends 100 a second, as if every app refreshed within two
//              minutes (after an outage, say).
//
// Each vpn app comes from its own address (X-Forwarded-For), as they do in
// life: run it with TRUSTED_PROXIES trusting the Docker network, or the
// per-address limit on links (30 a minute) is all it measures.
//
//   docker run --rm -i --add-host host.docker.internal:host-gateway grafana/k6 run - < k6.js
import http from "k6/http";
import crypto from "k6/crypto";
import { check, sleep } from "k6";

const BASE = __ENV.BASE_URL || "https://host.docker.internal";

export const options = {
  insecureSkipTLSVerify: true,
  scenarios: {
    visitors: {
      executor: "ramping-vus",
      exec: "visitor",
      stages: [
        { duration: "30s", target: 100 },
        { duration: "1m", target: 300 },
        { duration: "1m", target: 300 },
        { duration: "20s", target: 0 },
      ],
    },
    vpnApps: {
      executor: "constant-arrival-rate",
      exec: "vpnApp",
      rate: 100,
      timeUnit: "1s",
      duration: "2m",
      startTime: "30s",
      preAllocatedVUs: 50,
      maxVUs: 300,
    },
  },
  thresholds: {
    "http_req_failed": ["rate<0.01"],
    "http_req_duration{kind:api}": ["p(95)<500"],
    "http_req_duration{kind:page}": ["p(95)<300"],
    "http_req_duration{kind:link}": ["p(95)<800"],
  },
};

const randomIp = () => `${10 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${1 + Math.floor(Math.random() * 250)}`;

export function visitor() {
  const ip = { headers: { "X-Forwarded-For": randomIp() } };
  check(http.get(`${BASE}/`, { ...ip, tags: { kind: "page" } }), { "home 200": (r) => r.status === 200 });
  check(http.get(`${BASE}/api/v1/shop/plans`, { ...ip, tags: { kind: "api" } }), { "plans 200": (r) => r.status === 200 });
  sleep(1 + Math.random() * 2);
  const feed = http.get(`${BASE}/api/v1/posts`, { ...ip, tags: { kind: "api" } });
  check(feed, { "posts 200": (r) => r.status === 200 });
  const posts = feed.status === 200 ? feed.json("posts") : [];
  if (posts && posts.length) {
    const slug = posts[Math.floor(Math.random() * posts.length)].slug;
    check(http.get(`${BASE}/api/v1/posts/${encodeURIComponent(slug)}`, { ...ip, tags: { kind: "api" } }), {
      "post 200": (r) => r.status === 200,
    });
  }
  check(http.get(`${BASE}/pricing`, { ...ip, tags: { kind: "page" } }), { "pricing 200": (r) => r.status === 200 });
  sleep(2 + Math.random() * 3);
}

export function vpnApp() {
  const n = 1 + Math.floor(Math.random() * 10000);
  const token = `lt${crypto.md5(String(n), "hex")}`;
  const res = http.get(`${BASE}/s/${token}`, {
    headers: { "User-Agent": "v2rayNG/1.9.0", "X-Forwarded-For": randomIp() },
    tags: { kind: "link" },
  });
  check(res, { "link 200": (r) => r.status === 200 });
}
