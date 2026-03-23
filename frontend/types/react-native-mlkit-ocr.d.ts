declare module 'react-native-mlkit-ocr' {
  type OcrBlock = {
    text?: string;
  };

  type OcrResult = {
    text?: string;
    blocks?: OcrBlock[];
  };

  const MlkitOcr: {
    detectFromUri?: (uri: string) => Promise<OcrBlock[] | OcrResult>;
    detectFromFile?: (uri: string) => Promise<OcrBlock[] | OcrResult>;
  };

  export default MlkitOcr;
}
