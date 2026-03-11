import axios, { AxiosError } from 'axios';

type ErrorDetails = {
  message: string;
  status: number | null;
  method: string;
  url: string;
  response: unknown;
};

export const getAxiosErrorDetails = (error: unknown): ErrorDetails => {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    return {
      message: axiosError.message || 'Axios request failed',
      status: axiosError.response?.status ?? null,
      method: String(axiosError.config?.method || '').toUpperCase(),
      url: String(axiosError.config?.url || ''),
      response: axiosError.response?.data ?? null,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      status: null,
      method: '',
      url: '',
      response: null,
    };
  }

  return {
    message: String(error ?? 'Unknown error'),
    status: null,
    method: '',
    url: '',
    response: null,
  };
};

