declare module 'pdf-parse/lib/pdf-parse.js' {
  function pdfParse(
    dataBuffer: Buffer | Uint8Array,
    options?: import('pdf-parse').Options,
  ): Promise<import('pdf-parse').Result>;
  export default pdfParse;
}
