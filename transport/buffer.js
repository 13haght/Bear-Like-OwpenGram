import { Buffer } from 'buffer';

/**
 * feross buffer 6 inherits TypedArray.subarray and relies on @@species to keep
 * Buffer methods. Hermes returns Uint8Array instead, so teleproto's obfuscated
 * header fails at encrypt(header).subarray(56).copy(header, 56).
 * Reattach this bundle's Buffer prototype while preserving the zero-copy view,
 * byteOffset and native index coercion. Do not patch global Uint8Array/Buffer.
 */
const nativeSubarray = Uint8Array.prototype.subarray;
Object.defineProperty(Buffer.prototype, 'subarray', {
  configurable: true,
  writable: true,
  value: function subarray(start, end) {
    const view = nativeSubarray.call(this, start, end);
    Object.setPrototypeOf(view, Buffer.prototype);
    return view;
  },
});

export { Buffer };
