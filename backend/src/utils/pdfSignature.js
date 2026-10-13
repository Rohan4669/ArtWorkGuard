/** A PDF must start with %PDF- within the first 1024 bytes (spec allows leading junk) and contain %%EOF near the end. */
export function looksLikePdf(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return false;
  const head = buf.subarray(0, 1024).toString('latin1');
  if (!head.includes('%PDF-')) return false;
  const tail = buf.subarray(Math.max(0, buf.length - 2048)).toString('latin1');
  return tail.includes('%%EOF');
}
