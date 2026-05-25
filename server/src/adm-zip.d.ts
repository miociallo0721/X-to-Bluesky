declare module 'adm-zip' {
  export interface IZipEntry {
    entryName: string;
    getData(): Buffer;
  }

  export default class AdmZip {
    constructor(buffer?: Buffer);
    getEntries(): IZipEntry[];
  }
}
