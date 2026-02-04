import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SMS from 'expo-sms';

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function Index() {
  const [userId, setUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [currentView, setCurrentView] = useState<'setup' | 'home'>('setup');

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      const savedUserId = await AsyncStorage.getItem('userId');
      if (savedUserId) {
        setUserId(savedUserId);
        setCurrentView('home');
      }
    } catch (error) {
      console.error('Error checking user:', error);
    } finally {
      setLoading(false);
    }
  };

  const createUser = async () => {
    if (!name.trim() || !email.trim()) {
      Alert.alert('Error', 'Please enter your name and email');
      return;
    }

    try {
      setLoading(true);
      const response = await axios.post(`${EXPO_PUBLIC_BACKEND_URL}/api/users`, {
        name: name.trim(),
        email: email.trim(),
      });
      
      const newUserId = response.data.id;
      await AsyncStorage.setItem('userId', newUserId);
      setUserId(newUserId);
      setCurrentView('home');
      Alert.alert('Success', 'Welcome to SpendWise!');
    } catch (error) {
      console.error('Error creating user:', error);
      Alert.alert('Error', 'Failed to create account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  if (currentView === 'setup') {
    return (
      <View style={styles.container}>
        <View style={styles.setupContainer}>
          <Ionicons name="wallet" size={80} color="#4CAF50" />
          <Text style={styles.title}>SpendWise</Text>
          <Text style={styles.subtitle}>AI-Powered Financial Habit Tracker</Text>
          
          <View style={styles.inputContainer}>
            <Ionicons name="person" size={20} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Your Name"
              placeholderTextColor="#999"
              value={name}
              onChangeText={setName}
            />
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="mail" size={20} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Your Email"
              placeholderTextColor="#999"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={createUser}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Get Started</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.homeContainer}>
        <View style={styles.header}>
          <View>
            <Text style={styles.welcomeText}>Welcome Back!</Text>
            <Text style={styles.headerSubtext}>Track your financial journey</Text>
          </View>
          <TouchableOpacity style={styles.iconButton}>
            <Ionicons name="notifications-outline" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.quickActionsGrid}>
          <TouchableOpacity style={styles.actionCard}>
            <View style={[styles.actionIconContainer, { backgroundColor: '#E3F2FD' }]}>
              <Ionicons name="add-circle" size={32} color="#2196F3" />
            </View>
            <Text style={styles.actionText}>Add Transaction</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionCard}>
            <View style={[styles.actionIconContainer, { backgroundColor: '#F3E5F5' }]}>
              <Ionicons name="mail" size={32} color="#9C27B0" />
            </View>
            <Text style={styles.actionText}>Scan SMS</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionCard}>
            <View style={[styles.actionIconContainer, { backgroundColor: '#FFF3E0' }]}>
              <Ionicons name="card" size={32} color="#FF9800" />
            </View>
            <Text style={styles.actionText}>Credit Cards</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionCard}>
            <View style={[styles.actionIconContainer, { backgroundColor: '#E8F5E9' }]}>
              <Ionicons name="chatbubbles" size={32} color="#4CAF50" />
            </View>
            <Text style={styles.actionText}>AI Assistant</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Coming Soon</Text>
          <Text style={styles.sectionSubtext}>Full app with analytics, insights, and more!</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1e',
  },
  setupContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  homeContainer: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 24,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#999',
    marginBottom: 48,
    textAlign: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    width: '100%',
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    paddingVertical: 16,
  },
  primaryButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
    marginTop: 24,
    width: '100%',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  headerSubtext: {
    fontSize: 14,
    color: '#999',
  },
  iconButton: {
    padding: 8,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 16,
  },
  actionCard: {
    width: '47%',
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  actionIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  actionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  section: {
    padding: 24,
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  sectionSubtext: {
    fontSize: 14,
    color: '#999',
  },
});