import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildM1Index, buildM1MovieObject } from "@bdmv2web/test-fixtures";

class ByteWriter {
  private readonly bytes: number[] = [];

  u8(value: number): this { this.bytes.push(value & 0xff); return this; }
  u16(value: number): this { this.bytes.push((value >>> 8) & 0xff, value & 0xff); return this; }
  u32(value: number): this { this.bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff); return this; }
  ascii(value: string): this { for (const character of value) this.bytes.push(character.charCodeAt(0)); return this; }
  zeros(count: number): this { for (let index = 0; index < count; index += 1) this.bytes.push(0); return this; }
  appString(value: string): this { this.u8(value.length); this.ascii(value); if ((value.length & 1) === 0) this.u8(0); return this; }

  section(write: (section: ByteWriter) => void): this {
    const payload = new ByteWriter();
    write(payload);
    this.u32(payload.bytes.length);
    for (const byte of payload.bytes) this.bytes.push(byte);
    return this;
  }

  toBytes(): Uint8Array { return Uint8Array.from(this.bytes); }
}

/** Minimal BDJO that declares one application whose JAR is `JAR/<basePath>.jar`. */
export function buildBdjo(options: { basePath: string; initialClass: string }): Uint8Array {
  const writer = new ByteWriter();
  writer.ascii("BDJO0200").zeros(40);
  writer.section((section) => { section.ascii("*****").u8(0).zeros(4); });
  writer.section((section) => { section.u8(0).u8(0); });
  writer.section((section) => { section.u8(0).u8(0x18).u16(0); });
  writer.section((section) => {
    section.u8(1).u8(0);                         // one application
    section.u8(1).u8(0x10);                      // control code, application type
    section.u32(0x11223344).u16(7).zeros(10);    // organization, application id
    section.u16(0);                              // no profiles
    section.u8(0).u8(0);                         // priority, binding/visibility
    section.u16(0);                              // no application names
    section.appString("");                       // icon locator
    section.u16(0);                              // icon flags
    section.appString(options.basePath);
    section.appString("");                       // class path
    section.appString(options.initialClass);
    section.u8(0).u8(0);                         // no parameters
  });
  writer.u8(0x80).zeros(3);                      // key interest
  writer.u16(2).ascii("./");                     // file access path
  return writer.toBytes();
}

/**
 * Write a package input whose first-play and top-menu entries are BD-J. `mixed`
 * adds one HDMV title entry so the same build branch also covers a mixed disc.
 */
export async function writeBdjDisc(parent: string, options: { mixed?: boolean } = {}): Promise<string> {
  const disc = join(parent, "BDMV");
  for (const directory of ["BDJO", "PLAYLIST", "CLIPINF", "STREAM", "JAR"]) await mkdir(join(disc, directory), { recursive: true });
  const index = buildM1Index({ first: 0, top: 1, bdjTitle: "00042", ...(options.mixed ? { hdmvTitle: 3 } : {}) });
  for (const offset of [92, 104]) {
    index[offset] = 0x80;
    index.set(new TextEncoder().encode("00042"), offset + 6);
  }
  await writeFile(join(disc, "index.bdmv"), index);
  await writeFile(join(disc, "MovieObject.bdmv"), buildM1MovieObject());
  await writeFile(join(disc, "BDJO", "00042.bdjo"), buildBdjo({ basePath: "00000", initialClass: "fixture.Menu" }));
  await writeFile(join(disc, "JAR", "00000.jar"), new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  return disc;
}
