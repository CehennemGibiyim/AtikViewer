declare module "jpeg-lossless-decoder-js" {
  export class Decoder {
    constructor(buffer?: ArrayBuffer | null, numBytes?: number | null);
    decode(buffer: ArrayBufferLike, offset?: number, length?: number, numBytes?: number): ArrayBuffer;
  }
}
