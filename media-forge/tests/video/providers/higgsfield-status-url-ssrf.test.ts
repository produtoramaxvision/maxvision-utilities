import { describe, it, expect } from 'vitest';
import { isSafeHiggsfieldStatusUrl } from '../../../src/video/providers/higgsfield.js';

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
