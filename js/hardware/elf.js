// Just enough of an ELF32 reader for a linked Blinks game: section sizes (for
// the flash and RAM a game uses) and the symbol table (to find blinklib's
// variables in the emulated RAM).

const SHT_SYMTAB = 2;

export function readElf(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0) !== 0x7f454c46) throw new Error('not an ELF file');
  const shoff = dv.getUint32(32, true), shentsize = dv.getUint16(46, true), shnum = dv.getUint16(48, true), shstrndx = dv.getUint16(50, true);
  const section = (i) => {
    const o = shoff + i * shentsize;
    return { name: dv.getUint32(o, true), type: dv.getUint32(o + 4, true), addr: dv.getUint32(o + 12, true), offset: dv.getUint32(o + 16, true), size: dv.getUint32(o + 20, true), link: dv.getUint32(o + 24, true), entsize: dv.getUint32(o + 36, true) };
  };
  const str = (sec, at) => { let s = ''; for (let i = sec.offset + at; bytes[i]; i++) s += String.fromCharCode(bytes[i]); return s; };
  const shstr = section(shstrndx);
  const sections = {};
  const symbols = [];
  for (let i = 0; i < shnum; i++) {
    const s = section(i);
    sections[str(shstr, s.name)] = { addr: s.addr, size: s.size };
    if (s.type !== SHT_SYMTAB) continue;
    const strtab = section(s.link);
    for (let o = s.offset; o < s.offset + s.size; o += s.entsize) {
      const info = bytes[o + 12];
      symbols.push({ name: str(strtab, dv.getUint32(o, true)), value: dv.getUint32(o + 4, true), size: dv.getUint32(o + 8, true), local: (info >> 4) === 0 });
    }
  }
  return { sections, symbols };
}

// blinklib's own `faces` and `now`, as RAM addresses. `faces` is static, so a
// local symbol with a C++ mangled name; `now` is global unless LTO made it
// local (and a sketch can't have a global of its own by that name).
export function blinklibSymbols(elf) {
  const named = (name, size) => elf.symbols.filter((s) => (s.name === name || s.name === `_ZL${name.length}${name}`) && s.size === size);
  const find = (name, size) => { const all = named(name, size); return all.find((s) => s.local) ?? all[0]; };
  const ram = (s) => (s ? s.value & 0xffff : null);
  return { faces: ram(find('faces', 6 * FACE_BYTES)), now: ram(find('now', 4)) };
}

// blinklib's face_t: inValue, outValue, expireTime, sendTime, then the datagram buffers
export const FACE_BYTES = 44;
export const FACE = { inValue: 0, outValue: 1, expireTime: 2, sendTime: 6 };

// Flash and RAM a game uses, counted the way the Arduino IDE does (platform.txt's recipe.size.regex)
export function memoryUse(elf) {
  const size = (n) => elf.sections[n]?.size ?? 0;
  return { flash: size('.text') + size('.data'), ram: size('.data') + size('.bss') + size('.noinit') };
}
