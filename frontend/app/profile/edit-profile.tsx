import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  getSavedUserId,
  getUserById,
  updateUserProfile,
  type UpdateUserProfilePayload,
  type UserProfile,
} from '../../lib/auth';

type FormState = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  profession: string;
  education: string;
  gender: string;
  monthlyIncome: string;
  savingAmount: string;
};

const toFormState = (user: UserProfile): FormState => ({
  firstName: user.first_name ?? '',
  lastName: user.last_name ?? '',
  phone: user.phone ?? '',
  email: user.email ?? '',
  city: user.city ?? '',
  state: user.state ?? '',
  profession: user.profession ?? '',
  education: user.education ?? '',
  gender: user.gender ?? '',
  monthlyIncome: user.monthly_income != null ? String(user.monthly_income) : '',
  savingAmount: user.saving_amount != null ? String(user.saving_amount) : '',
});

const parseOptionalNumber = (value: string): number | null => {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
};

export default function EditProfileScreen() {
  const [userId, setUserId] = useState('');
  const [form, setForm] = useState<FormState>({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    city: '',
    state: '',
    profession: '',
    education: '',
    gender: '',
    monthlyIncome: '',
    savingAmount: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const savedUserId = await getSavedUserId();
        if (!savedUserId) {
          router.replace('/login');
          return;
        }
        setUserId(savedUserId);
        const user = await getUserById(savedUserId);
        setForm(toFormState(user));
      } catch (error) {
        Alert.alert('Error', error instanceof Error ? error.message : 'Unable to load profile');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const setField = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    const monthlyIncome = parseOptionalNumber(form.monthlyIncome);
    const savingAmount = parseOptionalNumber(form.savingAmount);

    if (Number.isNaN(monthlyIncome) || Number.isNaN(savingAmount)) {
      Alert.alert('Validation', 'Monthly income and saving amount must be valid numbers');
      return;
    }

    if (monthlyIncome !== null && monthlyIncome < 0) {
      Alert.alert('Validation', 'Monthly income cannot be negative');
      return;
    }

    if (savingAmount !== null && savingAmount < 0) {
      Alert.alert('Validation', 'Saving amount cannot be negative');
      return;
    }

    const payload: UpdateUserProfilePayload = {
      first_name: form.firstName.trim() || null,
      last_name: form.lastName.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      profession: form.profession.trim() || null,
      education: form.education.trim() || null,
      gender: form.gender.trim() || null,
      monthly_income: monthlyIncome,
      saving_amount: savingAmount,
    };

    try {
      setSaving(true);
      const updated = await updateUserProfile(userId, payload);
      setForm(toFormState(updated));
      Alert.alert('Success', 'Profile updated successfully');
    } catch (error) {
      Alert.alert('Update Failed', error instanceof Error ? error.message : 'Unable to update profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color="#4CAF50" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Edit Profile</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Field label="First Name" value={form.firstName} onChangeText={(value) => setField('firstName', value)} />
        <Field label="Last Name" value={form.lastName} onChangeText={(value) => setField('lastName', value)} />
        <Field label="Phone Number" value={form.phone} onChangeText={(value) => setField('phone', value)} keyboardType="phone-pad" />
        <Field label="Email" value={form.email} onChangeText={(value) => setField('email', value)} keyboardType="email-address" autoCapitalize="none" />
        <Field label="City" value={form.city} onChangeText={(value) => setField('city', value)} />
        <Field label="State" value={form.state} onChangeText={(value) => setField('state', value)} />
        <Field label="Profession" value={form.profession} onChangeText={(value) => setField('profession', value)} />
        <Field label="Education" value={form.education} onChangeText={(value) => setField('education', value)} />
        <Field label="Gender" value={form.gender} onChangeText={(value) => setField('gender', value)} />
        <Field
          label="Monthly Income"
          value={form.monthlyIncome}
          onChangeText={(value) => setField('monthlyIncome', value)}
          keyboardType="numeric"
        />
        <Field
          label="Saving Amount"
          value={form.savingAmount}
          onChangeText={(value) => setField('savingAmount', value)}
          keyboardType="numeric"
        />

        <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save Profile</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
};

function Field({ label, value, onChangeText, keyboardType = 'default', autoCapitalize = 'sentences' }: FieldProps) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        style={styles.input}
        placeholder={label}
        placeholderTextColor="#667085"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1e',
  },
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  fieldWrap: {
    marginTop: 14,
  },
  label: {
    color: '#9aa0b4',
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#2a2a3e',
    backgroundColor: '#1a1a2e',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  saveButton: {
    marginTop: 20,
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  saveText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
