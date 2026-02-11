function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function generateSaltBase64(byteLen = 16): string {
  const salt = new Uint8Array(byteLen);
  crypto.getRandomValues(salt);
  return bytesToBase64(salt);
}

export async function pbkdf2HashBase64(password: string, saltBase64: string, iterations = 150_000): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const saltBytes = base64ToBytes(saltBase64);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes as BufferSource, iterations },
    keyMaterial,
    256
  );
  return bytesToBase64(new Uint8Array(bits));
}


