import { describe, it, expect } from 'vitest';
import { mimeFromExt, isImageMime, isVideoMime } from '../../../src/utils/mime.js';

describe('mimeFromExt', () => {
  it('resolves image extensions', () => {
    expect(mimeFromExt('a.png')).toBe('image/png');
    expect(mimeFromExt('B.JPG')).toBe('image/jpeg');
    expect(mimeFromExt('photo.jpeg')).toBe('image/jpeg');
    expect(mimeFromExt('x.webp')).toBe('image/webp');
    expect(mimeFromExt('x.heic')).toBe('image/heic');
    expect(mimeFromExt('x.heif')).toBe('image/heif');
  });

  it('resolves video extensions', () => {
    expect(mimeFromExt('v.mp4')).toBe('video/mp4');
    expect(mimeFromExt('v.mov')).toBe('video/quicktime');
    expect(mimeFromExt('v.webm')).toBe('video/webm');
  });

  it('throws on unsupported ext', () => {
    expect(() => mimeFromExt('a.gif')).toThrow();
    expect(() => mimeFromExt('a.bmp')).toThrow();
  });

  it('throws on missing extension', () => {
    expect(() => mimeFromExt('noext')).toThrow();
  });
});

describe('isImageMime / isVideoMime', () => {
  it('classifies correctly', () => {
    expect(isImageMime('image/png')).toBe(true);
    expect(isImageMime('video/mp4')).toBe(false);
    expect(isVideoMime('video/mp4')).toBe(true);
    expect(isVideoMime('image/png')).toBe(false);
  });
});
