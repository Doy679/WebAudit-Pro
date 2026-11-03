import { describe, it, expect } from "vitest";
import { isBlockedIp, assertPublicUrl, UnsafeUrlError } from "../src/security/ssrf.js";

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1",
  ])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(["93.184.215.14", "8.8.8.8", "172.32.0.1", "2606:4700::1111"])("allows public %s", (ip) =>
    expect(isBlockedIp(ip)).toBe(false));
});

describe("assertPublicUrl", () => {
  const rejects = (url: string, opts = {}) => expect(assertPublicUrl(url, opts)).rejects.toBeInstanceOf(UnsafeUrlError);

  it("rejects non-http schemes, credentials and malformed URLs", async () => {
    await rejects("ftp://example.com/");
    await rejects("file:///etc/passwd");
    await rejects("http://user:pass@example.com/");
    await rejects("not a url");
  });

  it("rejects loopback, private and cloud metadata addresses", async () => {
    await rejects("http://127.0.0.1:3000/");
    await rejects("http://localhost/");
    await rejects("http://169.254.169.254/latest/meta-data/");
    await rejects("http://[::1]/");
    await rejects("http://10.0.0.5/");
  });

  it("allows loopback only under the explicit test policy", async () => {
    await expect(assertPublicUrl("http://127.0.0.1:3000/", { allowLoopback: true })).resolves.toBeDefined();
    await rejects("http://10.0.0.5/", { allowLoopback: true });
    await rejects("http://169.254.169.254/", { allowLoopback: true });
  });

  it("allows public IP literals", async () => {
    await expect(assertPublicUrl("https://93.184.215.14/")).resolves.toBeDefined();
  });
});
