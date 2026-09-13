// 'qrcode' ships no bundled type declarations and the React app uses it as
// plain JS. Provide a minimal ambient declaration for the small surface we use.
declare module 'qrcode' {
  interface QRCodeToDataURLOptions {
    width?: number;
    margin?: number;
    [key: string]: unknown;
  }
  const QRCode: {
    toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
  };
  export default QRCode;
}
