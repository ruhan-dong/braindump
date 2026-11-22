// Run with: npm test
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { fetchPicture, fetchPreview, isPrivateAddress, MAX_PICTURE_BYTES, readPicture } from "./links.ts";

/** Runs a server on this machine for the length of a test. */
async function withServer(handler: http.RequestListener, run: (origin: string) => Promise<void>) {
  const server = http.createServer(handler);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

const get = (url: string) => new Promise<http.IncomingMessage>((resolve, reject) => http.get(url, resolve).on("error", reject));

test("addresses that are not on the public internet are recognised", () => {
  const notPublic = [
    "127.0.0.1", // this machine
    "127.8.8.8",
    "0.0.0.0",
    "10.1.2.3", // private networks
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // where cloud providers serve instance credentials
    "100.64.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fd12:3456::1", // private IPv6
    "fe80::1",
    "::ffff:127.0.0.1", // IPv4 written as IPv6
    "::ffff:10.0.0.1",
    "not an address",
  ];
  for (const ip of notPublic) assert.equal(isPrivateAddress(ip), true, ip);
});

test("public addresses are allowed", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.215.14", "172.15.0.1", "172.32.0.1", "2606:4700:4700::1111"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("a preview never connects to this machine, however the address is written", async () => {
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits++;
    res.setHeader("content-type", "text/html");
    res.end("<title>internal page</title>");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  try {
    // The server does answer: otherwise "no hits" below would prove nothing.
    assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /internal page/);
    assert.equal(hits, 1);

    const urls = [
      `http://127.0.0.1:${port}/`,
      `http://localhost:${port}/`, // a name that resolves to this machine
      `http://2130706433:${port}/`, // 127.0.0.1 as one number
      `http://0x7f.0.0.1:${port}/`, // 127.0.0.1 in hexadecimal
      `http://[::ffff:127.0.0.1]:${port}/`,
      `http://0.0.0.0:${port}/`,
    ];
    for (const url of urls) {
      const preview = await fetchPreview(url);
      assert.equal(preview.title, null, url);
      assert.equal(preview.url, url); // the link itself is still saved, just without a preview
    }
    assert.equal(hits, 1, "the previews must not have reached the server");
  } finally {
    server.close();
  }
});

test("a preview picture is kept only if it is a picture", async () => {
  const png = Buffer.from("not really a png, but served as one");
  const types: Record<string, string> = { "/a.png": "image/png", "/a.html": "text/html", "/a.svg": "image/svg+xml", "/a.bin": "application/octet-stream" };
  await withServer(
    (req, res) => {
      if (req.url === "/gone.png") res.statusCode = 404;
      res.setHeader("content-type", types[req.url!] ?? "image/png");
      res.end(png);
    },
    async (origin) => {
      assert.deepEqual(await readPicture(await get(`${origin}/a.png`)), { body: png, mime: "image/png" });
      for (const path of ["/a.html", "/a.svg", "/a.bin", "/gone.png"]) assert.equal(await readPicture(await get(origin + path)), null, path);
    },
  );
});

test("a preview picture over the size limit is refused", async () => {
  const tooBig = Buffer.alloc(MAX_PICTURE_BYTES + 1);
  await withServer(
    (req, res) => {
      res.setHeader("content-type", "image/jpeg");
      if (req.url === "/announced") res.end(tooBig); // says how long it is up front
      else if (req.url === "/unannounced") res.write(tooBig, () => res.end()); // sent in pieces, with no length
      else res.end(tooBig.subarray(1));
    },
    async (origin) => {
      assert.equal(await readPicture(await get(`${origin}/announced`)), null);
      assert.equal(await readPicture(await get(`${origin}/unannounced`)), null);
      assert.equal((await readPicture(await get(`${origin}/at-the-limit`)))?.body.length, MAX_PICTURE_BYTES);
    },
  );
});

test("a preview picture is never downloaded from this machine", async () => {
  let hits = 0;
  await withServer(
    (_req, res) => {
      hits++;
      res.setHeader("content-type", "image/png");
      res.end("png");
    },
    async (origin) => {
      // The server does answer with a picture: otherwise "no hits" below would prove nothing.
      assert.equal((await readPicture(await get(`${origin}/a.png`)))?.mime, "image/png");
      assert.equal(hits, 1);

      const { port } = new URL(origin);
      for (const url of [`${origin}/a.png`, `http://localhost:${port}/a.png`, `http://[::ffff:127.0.0.1]:${port}/a.png`, `http://169.254.169.254/a.png`]) {
        assert.equal(await fetchPicture(url), null, url);
      }
      // A page can name its picture with a relative address; that is resolved against the page before the check.
      assert.equal(await fetchPicture("/a.png", `${origin}/page`), null);
      assert.equal(hits, 1, "the downloads must not have reached the server");
    },
  );
});
