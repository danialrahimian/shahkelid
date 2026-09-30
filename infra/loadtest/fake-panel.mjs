// A stand-in for the PasarGuard panel's subscription endpoint, for the load
// test: it answers /sub/<token> the way the panel does (a base64 list of
// configs and the headers apps read), after a delay like a panel abroad.
import { createServer } from "node:http";

const DELAY_MS = Number(process.env.DELAY_MS ?? 60);
const body = Buffer.from(
  Array.from({ length: 6 }, (_, i) => `vless://00000000-0000-0000-0000-00000000000${i}@de${i}.example.com:443?security=reality#DE-${i}`).join("\n"),
).toString("base64");

createServer((req, res) => {
  setTimeout(() => {
    if (!req.url?.startsWith("/sub/")) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "subscription-userinfo": "upload=0; download=1073741824; total=53687091200; expire=1893456000",
      "profile-update-interval": "12",
    });
    res.end(body);
  }, DELAY_MS);
}).listen(8080, () => console.log(`fake panel on :8080, ${DELAY_MS} ms per answer`));
