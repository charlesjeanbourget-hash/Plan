export interface ParsedCv {
  name: string;
  email: string;
  phone: string;
  notes: string;
}

export function parseCvText(raw: string): ParsedCv {
  const text = raw.replace(/\r/g, '\n');
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '';
  const phone = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0] ?? '';
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 1 && !l.includes('@') && !/^\d/.test(l));
  const name = (lines[0] ?? '').replace(/^nom\s*[:\-]\s*/i, '').slice(0, 80);
  return { name, email, phone, notes: text.slice(0, 2500) };
}

export async function readCvFile(file: File): Promise<string> {
  if (file.type.startsWith('text/') || /\.(txt|md|csv|rtf)$/i.test(file.name)) {
    return file.text();
  }
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < Math.min(bytes.length, 200000); i += 1) {
    const c = bytes[i];
    out += c >= 32 && c < 127 ? String.fromCharCode(c) : (c === 10 || c === 13 ? '\n' : ' ');
  }
  return out.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n');
}
