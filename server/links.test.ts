// Run with: npm test
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { fetchPreview, isPrivateAddress } from "./links.ts";

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
