import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, type Href } from 'expo-router';
import { getSavedUserId } from '../../lib/auth';
import { getLearnHome, type LearnHome, type QuizOption } from '../../lib/learnApi';

export default function Learn() {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [homeData, setHomeData] = useState<LearnHome | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  React.useEffect(() => {
    const loadLearnHome = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const userId = await getSavedUserId();
        if (!userId) {
          setLoadError('Login required to load Learn data');
          return;
        }
        const payload = await getLearnHome(userId);
        setHomeData(payload);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : 'Unable to load Learn data');
      } finally {
        setIsLoading(false);
      }
    };

    void loadLearnHome();
  }, []);

  const quizOptions: QuizOption[] = homeData?.quiz_options ?? [];

  const quizFeedback = useMemo(() => {
    if (!selectedOption || !homeData) return null;
    const selected = quizOptions.find((opt) => opt.id === selectedOption);
    if (!selected) return null;
    return selected.correct ? homeData.quiz_feedback_correct : homeData.quiz_feedback_wrong;
  }, [homeData, quizOptions, selectedOption]);

  const mascotProgress = homeData?.mascot_progress ?? 72;
  const userName = homeData?.user_name ?? 'Alex';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Good morning, {userName}!</Text>
            <Text style={styles.subtitle}>Your money skills are growing every day.</Text>
          </View>
          <View style={styles.mascotWrap}>
            <View style={styles.ringTrack}>
              <View style={[styles.ringFill, { width: `${mascotProgress}%` }]} />
            </View>
            <View style={styles.mascotBadge}>
              <Ionicons name="leaf-outline" size={20} color="#0E7C66" />
            </View>
          </View>
        </View>

        {isLoading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color="#27E2BF" />
            <Text style={styles.loadingText}>Loading learn module...</Text>
          </View>
        ) : null}

        {loadError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        ) : null}

        <LinearGradient
          colors={['#0B7B68', '#19B99E']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <Text style={styles.heroEyebrow}>Your Daily Dose</Text>
          <Text style={styles.heroQuestion}>
            {homeData?.quiz_question ?? "Quiz: What's the #1 rule of investing?"}
          </Text>

          <View style={styles.quizOptionsWrap}>
            {quizOptions.map((option) => {
              const isSelected = selectedOption === option.id;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[styles.quizOption, isSelected && styles.quizOptionSelected]}
                  onPress={() => setSelectedOption(option.id)}
                  activeOpacity={0.9}
                >
                  <Text style={[styles.quizOptionText, isSelected && styles.quizOptionTextSelected]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {quizFeedback && <Text style={styles.quizFeedback}>{quizFeedback}</Text>}

          <TouchableOpacity
            style={styles.primaryCta}
            onPress={() => router.push('/learn/daily-dose')}
            activeOpacity={0.9}
          >
            <Text style={styles.primaryCtaText}>Open today's lesson</Text>
            <Ionicons name="arrow-forward" size={16} color="#0B6D5D" />
          </TouchableOpacity>
        </LinearGradient>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Continue Your Journey</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pathwayRow}>
          {(homeData?.pathways ?? []).map((path) => (
            <TouchableOpacity
              key={path.slug}
              style={styles.pathwayCard}
              activeOpacity={0.92}
              onPress={() => router.push(`/learn/pathway/${path.slug}` as Href)}
            >
              <View style={styles.pathwayTopRow}>
                <View style={styles.pathwayIconWrap}>
                  <Ionicons name={path.icon as any} size={18} color="#0E7C66" />
                </View>
                <Text style={styles.pathwayTime}>{path.time_left}</Text>
              </View>
              <Text style={styles.pathwayTitle}>{path.title}</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${path.progress}%` }]} />
              </View>
              <Text style={styles.progressText}>{path.progress}% complete</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <TouchableOpacity
          style={styles.challengeCard}
          activeOpacity={0.92}
          onPress={() => router.push('/learn/challenge')}
        >
          <View style={styles.challengeHeader}>
            <View style={styles.trophyWrap}>
              <Ionicons name="trophy-outline" size={20} color="#0E7C66" />
            </View>
            <Text style={styles.challengeTitle}>{homeData?.challenge.title ?? 'Savings Challenge'}</Text>
          </View>
          <Text style={styles.challengeText}>
            {homeData?.challenge.description ?? 'The "No-Spend Weekend" challenge is active.'}
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${homeData?.challenge.progress ?? 0}%` }]} />
          </View>
          <Text style={styles.progressText}>{homeData?.challenge.progress ?? 0}% complete</Text>
        </TouchableOpacity>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Learn by Doing</Text>
        </View>

        <View style={styles.toolsGrid}>
          {(homeData?.tools ?? []).map((tool) => (
            <TouchableOpacity
              key={tool.label}
              style={styles.toolItem}
              activeOpacity={0.92}
              onPress={() => router.push(tool.route as Href)}
            >
              <View style={styles.toolIconCircle}>
                <Ionicons name={tool.icon as any} size={22} color="#0E7C66" />
              </View>
              <Text style={styles.toolLabel}>{tool.label}</Text>
              <Text style={styles.toolSubLabel}>{tool.blurb}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#081F24',
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 16 : 8,
    paddingBottom: 34,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  greeting: {
    color: '#F4FFFC',
    fontSize: 27,
    fontWeight: '700',
  },
  subtitle: {
    color: '#A5CEC7',
    fontSize: 13,
    marginTop: 4,
  },
  mascotWrap: {
    alignItems: 'center',
    width: 90,
  },
  ringTrack: {
    width: 76,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#184149',
    overflow: 'hidden',
    marginBottom: 10,
  },
  ringFill: {
    height: '100%',
    backgroundColor: '#27E2BF',
  },
  mascotBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#D5FFF5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0F3138',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E4E57',
    padding: 12,
    marginBottom: 12,
  },
  loadingText: {
    color: '#CFFEF4',
    fontSize: 12,
    fontWeight: '600',
  },
  errorCard: {
    backgroundColor: '#4C1F25',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#9D4652',
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    color: '#FFDADF',
    fontSize: 12,
    fontWeight: '600',
  },
  heroCard: {
    borderRadius: 18,
    padding: 18,
    marginBottom: 20,
  },
  heroEyebrow: {
    color: '#DFFFF7',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  heroQuestion: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
    marginBottom: 14,
  },
  quizOptionsWrap: {
    gap: 10,
  },
  quizOption: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  quizOptionSelected: {
    backgroundColor: '#F3FFFC',
    borderColor: '#F3FFFC',
  },
  quizOptionText: {
    color: '#EEFFF9',
    fontSize: 13,
    fontWeight: '600',
  },
  quizOptionTextSelected: {
    color: '#095E52',
  },
  quizFeedback: {
    marginTop: 12,
    color: '#ECFFF7',
    fontSize: 12,
    fontWeight: '600',
  },
  primaryCta: {
    marginTop: 12,
    backgroundColor: '#E8FFF9',
    borderRadius: 999,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  primaryCtaText: {
    color: '#0B6D5D',
    fontSize: 13,
    fontWeight: '700',
  },
  sectionHeaderRow: {
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  pathwayRow: {
    gap: 12,
    paddingBottom: 6,
    marginBottom: 16,
  },
  pathwayCard: {
    width: 216,
    backgroundColor: '#0F3138',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E4E57',
    padding: 14,
  },
  pathwayTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  pathwayIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#CFFFF4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pathwayTime: {
    color: '#9DE2D5',
    fontSize: 12,
    fontWeight: '600',
  },
  pathwayTitle: {
    color: '#F2FFFC',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  progressTrack: {
    height: 8,
    backgroundColor: '#27545D',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#27E2BF',
    borderRadius: 999,
  },
  progressText: {
    marginTop: 8,
    color: '#A3E7D9',
    fontSize: 12,
    fontWeight: '600',
  },
  challengeCard: {
    backgroundColor: '#113940',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#23515A',
    padding: 14,
    marginBottom: 20,
  },
  challengeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  trophyWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#CFFFF4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  challengeTitle: {
    color: '#F6FFFC',
    fontSize: 15,
    fontWeight: '700',
  },
  challengeText: {
    color: '#DDFBF4',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  toolsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 14,
  },
  toolItem: {
    width: '47%',
    backgroundColor: '#0F3138',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E4E57',
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  toolIconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#D7FFF6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  toolLabel: {
    color: '#F3FFFC',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 3,
  },
  toolSubLabel: {
    color: '#9BD3C8',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 15,
  },
});
