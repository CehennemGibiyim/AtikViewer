/** Mozilla pdf.js tabanlı JpegImage (Cornerstone dağıtımı). 12-bit JPEG Extended desteği için. */
declare class JpegImage {
  colorTransform: boolean | undefined;
  width: number;
  height: number;
  parse(data: Uint8Array): void;
  getData(width: number, height: number): Uint8Array;
  getData16(width: number, height: number): Uint16Array;
}
export default JpegImage;
