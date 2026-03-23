declare module 'expo-document-picker' {
  export type DocumentPickerAsset = {
    uri: string;
    name: string;
    mimeType?: string;
    size?: number;
  };

  export type DocumentPickerSuccessResult = {
    canceled: false;
    assets: DocumentPickerAsset[];
  };

  export type DocumentPickerCanceledResult = {
    canceled: true;
    assets: [];
  };

  export type DocumentPickerResult =
    | DocumentPickerSuccessResult
    | DocumentPickerCanceledResult;

  export function getDocumentAsync(options?: {
    type?: string | string[];
    copyToCacheDirectory?: boolean;
    multiple?: boolean;
  }): Promise<DocumentPickerResult>;
}
