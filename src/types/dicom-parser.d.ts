declare module "dicom-parser" {
  export interface Fragment {
    offset: number;
    position: number;
    length: number;
  }

  export interface DicomElement {
    tag: string;
    vr?: string;
    length: number;
    dataOffset: number;
    hadUndefinedLength?: boolean;
    encapsulatedPixelData?: boolean;
    basicOffsetTable?: number[];
    fragments?: Fragment[];
    items?: { dataSet: DicomDataSet }[];
  }

  export interface DicomDataSet {
    byteArray: Uint8Array;
    elements: { [tag: string]: DicomElement };
    string(tag: string, index?: number): string | undefined;
    uint16(tag: string, index?: number): number | undefined;
    int16(tag: string, index?: number): number | undefined;
    uint32(tag: string, index?: number): number | undefined;
    intString(tag: string, index?: number): number | undefined;
    floatString(tag: string, index?: number): number | undefined;
  }

  export function parseDicom(byteArray: Uint8Array, options?: Record<string, unknown>): DicomDataSet;

  export function readEncapsulatedPixelDataFromFragments(
    dataSet: DicomDataSet,
    pixelDataElement: DicomElement,
    startFragmentIndex: number,
    numFragments: number,
    fragments?: Fragment[]
  ): Uint8Array;

  export function readEncapsulatedImageFrame(
    dataSet: DicomDataSet,
    pixelDataElement: DicomElement,
    frameIndex: number,
    basicOffsetTable?: number[],
    fragments?: Fragment[]
  ): Uint8Array;

  const dicomParser: { parseDicom: typeof parseDicom };
  export default dicomParser;
}
