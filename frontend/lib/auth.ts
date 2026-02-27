import axios, { AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const USER_ID_KEY = 'userId';

type ApiUser = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  city?: string | null;
  state?: string | null;
  profession?: string | null;
  education?: string | null;
  gender?: string | null;
  monthly_income?: number | null;
  saving_amount?: number | null;
  created_at?: string;
  updated_at?: string | null;
};

export type UserProfile = ApiUser;

export type SignupPayload = {
  name: string;
  email: string;
  password: string;
  confirm_password: string;
};

export type LoginPayload = {
  email: string;
  password: string;
};

export type UpdateUserProfilePayload = {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  profession?: string | null;
  education?: string | null;
  gender?: string | null;
  monthly_income?: number | null;
  saving_amount?: number | null;
};

const requireBackendUrl = () => {
  if (!EXPO_PUBLIC_BACKEND_URL) {
    throw new Error('Backend URL is not configured');
  }
};

const buildMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    const detail = (error as AxiosError<{ detail?: string | { msg?: string }[] }>).response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (first && typeof first.msg === 'string' && first.msg.trim()) {
        return first.msg;
      }
    }
    }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
};

export const getSavedUserId = async () => {
  return AsyncStorage.getItem(USER_ID_KEY);
};

export const saveUserId = async (userId: string) => {
  await AsyncStorage.setItem(USER_ID_KEY, userId);
};

export const clearUserId = async () => {
  await AsyncStorage.removeItem(USER_ID_KEY);
};

export const login = async (payload: LoginPayload): Promise<ApiUser> => {
  requireBackendUrl();
  try {
    const response = await axios.post<ApiUser>(`${EXPO_PUBLIC_BACKEND_URL}/api/auth/login`, payload);
    return response.data;
  } catch (error) {
    const message = buildMessage(error, 'Unable to login');
    throw new Error(message);
  }
};

export const signup = async (payload: SignupPayload): Promise<ApiUser> => {
  requireBackendUrl();
  try {
    const response = await axios.post<ApiUser>(`${EXPO_PUBLIC_BACKEND_URL}/api/auth/signup`, payload);
    return response.data;
  } catch (error) {
    const message = buildMessage(error, 'Unable to create account');
    throw new Error(message);
  }
};

export const getUserById = async (userId: string): Promise<UserProfile> => {
  requireBackendUrl();
  try {
    const response = await axios.get<UserProfile>(`${EXPO_PUBLIC_BACKEND_URL}/api/users/${userId}`);
    return response.data;
  } catch (error) {
    const message = buildMessage(error, 'Unable to fetch profile');
    throw new Error(message);
  }
};

export const updateUserProfile = async (
  userId: string,
  payload: UpdateUserProfilePayload
): Promise<UserProfile> => {
  requireBackendUrl();
  try {
    const response = await axios.put<UserProfile>(
      `${EXPO_PUBLIC_BACKEND_URL}/api/users/${userId}/profile`,
      payload
    );
    return response.data;
  } catch (error) {
    const message = buildMessage(error, 'Unable to update profile');
    throw new Error(message);
  }
};
