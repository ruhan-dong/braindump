import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { pipeline } from "node:stream";
import zlib from "node:zlib";
import type { Link } from "./db.ts";

// A preview is fetched by this server, from an address a user typed. Left unchecked, a user could point it at this
// machine or the private network around it and read the answer in the preview. So only addresses on the public
// internet are fetched, and that is checked again at every redirect.
const notPublic = new net.BlockList();
for (const [address, bits] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // shared by internet providers
  ["127.0.0.0", 8], // this machine
  ["169.254.0.0", 16], // link-local, where cloud providers serve instance credentials
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // reserved
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and broadcast
] as const) {
  notPublic.addSubnet(address, bits, "ipv4");
}
for (const [address, bits] of [
  ["::", 128], // unspecified
  ["::1", 128], // this machine
  ["64:ff9b::", 96], // IPv4 addresses translated to IPv6
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // private
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  notPublic.addSubnet(address, bits, "ipv6");
}

/** True for an address that is not on the public internet. An IPv4 address written as IPv6 (::ffff:10.0.0.1) counts as IPv4. */
export function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  return family === 0 || notPublic.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/** Looks a name up, and refuses it if any of its addresses is private. The connection uses this same lookup, so the
 *  address that was checked is the address that gets connected to. */
const publicLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    if (addresses.some((a) => isPrivateAddress(a.address))) return callback(new Error(`${hostname} is not a public address`), "");
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};

const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 300_000;

const request = (url: URL, signal: AbortSignal) =>
  new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      { lookup: publicLookup, signal, headers: { "user-agent": "Mozilla/5.0 (compatible; BrainDumpBot/0.1)", accept: "text/html,*/*", "accept-encoding": "gzip, br" } },
      resolve,
    );
    req.on("error", reject);
    req.end();
  });

/** The start of a response as text. Stops reading at MAX_HTML_BYTES, however long the page is. */
async function readText(res: http.IncomingMessage): Promise<string> {
  const encoding = res.headers["content-encoding"];
  const decoder = encoding === "gzip" ? zlib.createGunzip() : encoding === "br" ? zlib.createBrotliDecompress() : null;
  const stream = decoder ? pipeline(res, decoder, () => {}) : res;
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= MAX_HTML_BYTES) break;
    }
  } finally {
    res.destroy();
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Fetches a page from the public internet only. Throws for anything else. html is empty unless the page is HTML. */
async function fetchPublic(start: string): Promise<{ url: string; type: string; html: string }> {
  const signal = AbortSignal.timeout(6000);
  let url = new URL(start);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Not a web address: ${url.protocol}`);
    // An address typed as numbers never goes through the lookup above, so it is checked here.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && isPrivateAddress(host)) throw new Error(`${host} is not a public address`);

    const res = await request(url, signal);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.destroy();
      url = new URL(res.headers.location, url);
      continue;
    }
    const type = res.headers["content-type"] ?? "";
    if (!type.includes("html")) {
      res.destroy();
      return { url: url.href, type, html: "" };
    }
    return { url: url.href, type, html: await readText(res) };
  }
  throw new Error("Too many redirects");
}

function meta(html: string, key: string): string | null {
  // Matches <meta property="og:title" content="..."> in either attribute order.
  const a = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i").exec(html);
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i").exec(html);
  return decode((a ?? b)?.[1]?.trim() || null);
}

function decode(s: string | null) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

export async function fetchPreview(url: string): Promise<Omit<Link, "id">> {
  const fallback = { url, title: null, description: null, image: null, site_name: new URL(url).hostname.replace(/^www\./, "") };
  try {
    const { url: finalUrl, type, html } = await fetchPublic(url);
    if (type.startsWith("image/")) return { ...fallback, image: url };
    if (!type.includes("html")) return fallback;
    const title = meta(html, "og:title") ?? decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() || null);
    let image = meta(html, "og:image") ?? meta(html, "twitter:image");
    if (image) image = new URL(image, finalUrl).toString();
    return {
      url,
      title,
      description: meta(html, "og:description") ?? meta(html, "description"),
      image,
      site_name: meta(html, "og:site_name") ?? fallback.site_name,
    };
  } catch {
    return fallback;
  }
}
