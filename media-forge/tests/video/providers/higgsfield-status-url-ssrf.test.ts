import { describe, it, expect } from 'vitest';
import {
  isSafeHiggsfieldStatusUrl,
  isSafeHiggsfieldAssetUrl,
} from '../../../src/video/providers/higgsfield.js';

/**
 * Codex local round 8 PR#10 — SSRF allowlist for persisted status_url values.
 *
 * `pollStatus` uses the server-supplied URL when present. If the value is
 * tampered with (MITM, corrupted DB row) we must reject anything that is not
 * https + a higgsfield.ai-anchored host BEFORE issuing the GET.
 */
describe('isSafeHiggsfieldStatusUrl', () => {
  it('accepts apex https://higgsfield.ai/...', () => {
    expect(isSafeHiggsfieldStatusUrl('https://higgsfield.ai/requests/abc/status')).toBe(true);
  });

  it('accepts subdomain https://platform.higgsfield.ai/...', () => {
    expect(isSafeHiggsfieldStatusUrl('https://platform.higgsfield.ai/requests/abc/status')).toBe(
      true,
    );
    expect(isSafeHiggsfieldStatusUrl('https://cdn.higgsfield.ai/signed/x?token=y')).toBe(true);
  });

  it('rejects non-https schemes', () => {
    expect(isSafeHiggsfieldStatusUrl('http://platform.higgsfield.ai/r/x')).toBe(false);
    expect(isSafeHiggsfieldStatusUrl('ftp://platform.higgsfield.ai/r/x')).toBe(false);
    expect(isSafeHiggsfieldStatusUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeHiggsfieldStatusUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects internal/loopback hosts', () => {
    expect(isSafeHiggsfieldStatusUrl('https://127.0.0.1/status')).toBe(false);
    expect(isSafeHiggsfieldStatusUrl('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isSafeHiggsfieldStatusUrl('https://localhost/status')).toBe(false);
  });

  it('rejects look-alike hosts (suffix-impersonation guard)', () => {
    // myhiggsfield.ai → does not end with `.higgsfield.ai`
    expect(isSafeHiggsfieldStatusUrl('https://myhiggsfield.ai/r/x')).toBe(false);
    // higgsfield.ai.evil.com → host endsWith `.evil.com`, NOT `.higgsfield.ai`
    expect(isSafeHiggsfieldStatusUrl('https://higgsfield.ai.evil.com/r/x')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isSafeHiggsfieldStatusUrl('not a url')).toBe(false);
    expect(isSafeHiggsfieldStatusUrl('')).toBe(false);
    expect(isSafeHiggsfieldStatusUrl('//platform.higgsfield.ai/r/x')).toBe(false);
  });
});

/**
 * Codex P2 round 11 PR#10 — looser allowlist for download URLs.
 * Asset CDNs are often third-party (S3 signed, CloudFront), so the strict
 * higgsfield.ai anchor is too tight. The asset variant only blocks
 * obvious internal-IP literals + non-https + intranet TLDs.
 */
describe('isSafeHiggsfieldAssetUrl', () => {
  it('accepts higgsfield.ai apex + subdomains', () => {
    expect(isSafeHiggsfieldAssetUrl('https://higgsfield.ai/x.mp4')).toBe(true);
    expect(isSafeHiggsfieldAssetUrl('https://cdn.higgsfield.ai/signed/x?t=y')).toBe(true);
  });

  it('accepts third-party CDN hosts (S3, CloudFront, GCS)', () => {
    expect(isSafeHiggsfieldAssetUrl('https://higgsfield-prod.s3.amazonaws.com/file.mp4')).toBe(true);
    expect(isSafeHiggsfieldAssetUrl('https://d111111abcdef8.cloudfront.net/file.mp4')).toBe(true);
    expect(isSafeHiggsfieldAssetUrl('https://storage.googleapis.com/bucket/file.mp4')).toBe(true);
  });

  it('rejects non-https schemes', () => {
    expect(isSafeHiggsfieldAssetUrl('http://cdn.higgsfield.ai/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('ftp://cdn.example.com/x.mp4')).toBe(false);
  });

  it('rejects IPv4 loopback + RFC1918 private literals', () => {
    expect(isSafeHiggsfieldAssetUrl('https://127.0.0.1/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://127.5.6.7/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://0.0.0.0/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://10.0.0.5/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://192.168.1.1/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://172.16.0.1/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://172.31.255.255/x.mp4')).toBe(false);
  });

  it('rejects 172.x.x.x outside 16-31 range correctly (allows public range)', () => {
    expect(isSafeHiggsfieldAssetUrl('https://172.15.0.1/x.mp4')).toBe(true);
    expect(isSafeHiggsfieldAssetUrl('https://172.32.0.1/x.mp4')).toBe(true);
  });

  it('rejects link-local + AWS IMDS', () => {
    expect(isSafeHiggsfieldAssetUrl('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://169.254.1.1/x.mp4')).toBe(false);
  });

  it('rejects localhost + intranet TLDs', () => {
    expect(isSafeHiggsfieldAssetUrl('https://localhost/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://foo.localhost/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://server.local/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://internal.lan/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://api.internal/x.mp4')).toBe(false);
  });

  it('rejects IPv6 loopback + link-local', () => {
    expect(isSafeHiggsfieldAssetUrl('https://[::1]/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://[fe80::1]/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://[fc00::1]/x.mp4')).toBe(false);
  });

  // FIX (Codex P1 round 12, PR#10): three IPv6 SSRF bypasses the
  // literal-prefix `startsWith` checks missed.
  it('rejects full ULA range (fc00::/7), not just fc00:/fd00: literals', () => {
    // Docker IPv6 networks default to fd**::/8 — these MUST be blocked.
    expect(isSafeHiggsfieldAssetUrl('https://[fd12::1]/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://[fdab::1]/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://[fce0::1]/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://[fcff::1]/x.mp4')).toBe(false);
  });

  it('rejects full link-local range (fe80::/10), not just fe80: literal', () => {
    // /10 spans fe80-febf — all must be blocked.
    expect(isSafeHiggsfieldAssetUrl('https://[fe90::1]/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://[fea0::1]/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://[feb0::1]/x.mp4')).toBe(false);
  });

  it('rejects IPv4-mapped IPv6 loopback / private (::ffff:127.0.0.1 bypass)', () => {
    // Node URL parser normalizes ::ffff:127.0.0.1 → ::ffff:7f00:1, bypassing
    // the IPv4 startsWith('127.') check above.
    expect(isSafeHiggsfieldAssetUrl('https://[::ffff:127.0.0.1]/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://[::ffff:7f00:1]/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://[::ffff:10.0.0.1]/x.mp4')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('https://[::ffff:192.168.1.1]/x.mp4')).toBe(false);
  });

  it('rejects malformed', () => {
    expect(isSafeHiggsfieldAssetUrl('not a url')).toBe(false);
    expect(isSafeHiggsfieldAssetUrl('')).toBe(false);
  });
});
