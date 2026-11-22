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
export const MAX_PICTURE_BYTES = 5 * 1024 * 1024;
// Types a browser shows as a picture. SVG is left out: it can carry scripts.
const PICTURE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);

const PAGE_HEADERS = { accept: "text/html,*/*", "accept-encoding": "gzip, br" };
const PICTURE_HEADERS = { accept: "image/*" };

const request = (url: URL, signal: AbortSignal, headers: Record<string, string>) =>
  new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      { lookup: publicLookup, signal, headers: { "user-agent": "Mozilla/5.0 (compatible; BrainDumpBot/0.1)", ...headers } },
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

/** A picture as it was downloaded. */
export type Picture = { body: Buffer; mime: string };

/** A response as a picture. Null if it is not one, or is larger than MAX_PICTURE_BYTES. */
export async function readPicture(res: http.IncomingMessage): Promise<Picture | null> {
  try {
    const mime = (res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (res.statusCode !== 200 || !PICTURE_TYPES.has(mime)) return null;
    if (Number(res.headers["content-length"]) > MAX_PICTURE_BYTES) return null;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res) {
      size += chunk.length;
      if (size > MAX_PICTURE_BYTES) return null; // the size a server announces is not always the size it sends
      chunks.push(chunk);
    }
    return { body: Buffer.concat(chunks), mime };
  } finally {
    res.destroy();
  }
}

/** Opens an address on the public internet only, following redirects. Throws for anything else. The caller reads the
 *  response or destroys it; either way the whole exchange is cut off after 6 seconds. */
async function openPublic(start: string, headers: Record<string, string>): Promise<{ url: string; res: http.IncomingMessage }> {
  const signal = AbortSignal.timeout(6000);
  let url = new URL(start);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Not a web address: ${url.protocol}`);
    // An address typed as numbers never goes through the lookup above, so it is checked here.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && isPrivateAddress(host)) throw new Error(`${host} is not a public address`);

    const res = await request(url, signal, headers);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.destroy();
      url = new URL(res.headers.location, url);
      continue;
    }
    return { url: url.href, res };
  }
  throw new Error("Too many redirects");
}

/** Downloads a picture, from the public internet only. Null if there is none to be had: the address can't be reached
 *  or is not public, or what it serves is not a picture or is too large. */
export async function fetchPicture(url: string, base?: string): Promise<Picture | null> {
  try {
    return await readPicture((await openPublic(new URL(url, base).href, PICTURE_HEADERS)).res);
  } catch {
    return null;
  }
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

/** What a page says about itself, and its picture. The picture is downloaded here, once, so the link keeps it
 *  whatever the site does later. */
export type Preview = Omit<Link, "id" | "image"> & { picture: Picture | null };

export async function fetchPreview(url: string): Promise<Preview> {
  const fallback = { url, title: null, description: null, picture: null, site_name: new URL(url).hostname.replace(/^www\./, "") };
  try {
    const { url: finalUrl, res } = await openPublic(url, PAGE_HEADERS);
    const type = res.headers["content-type"] ?? "";
    if (!type.includes("html")) {
      res.destroy();
      // A link straight to a picture: the picture is its preview.
      return type.startsWith("image/") ? { ...fallback, picture: await fetchPicture(finalUrl) } : fallback;
    }
    const html = await readText(res);
    const title = meta(html, "og:title") ?? decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() || null);
    const image = meta(html, "og:image") ?? meta(html, "twitter:image");
    return {
      url,
      title,
      description: meta(html, "og:description") ?? meta(html, "description"),
      picture: image ? await fetchPicture(image, finalUrl) : null,
      site_name: meta(html, "og:site_name") ?? fallback.site_name,
    };
  } catch {
    return fallback;
  }
}
