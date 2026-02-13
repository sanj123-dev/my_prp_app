import React, { useState } from 'react';
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
import {
  claimLearnMission,
  getLearnHome,
  submitLearnQuizAnswer,
  type DailyMission,
  type LearnHome,
  type QuizOption,
} from '../../lib/learnApi';

export default function Learn() {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [homeData, setHomeData] = useState<LearnHome | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isSubmittingQuiz, setIsSubmittingQuiz] = useState(false);
  const [claimingMissionId, setClaimingMissionId] = useState<string | null>(null);
  const [quizFeedback, setQuizFeedback] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  React.useEffect(() => {
    const loadLearnHome = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const uid = await getSavedUserId();
        if (!uid) {
          setLoadError('Login required to load Learn data');
          return;
        }
        setUserId(uid);
        const payload = await getLearnHome(uid);
        setHomeData(payload);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : 'Unable to load Learn data');
      } finally {
        setIsLoading(false);
      }
    };

    void loadLearnHome();
  }, []);

  const refreshHome = async () => {
    if (!userId) return;
    const payload = await getLearnHome(userId);
    setHomeData(payload);
  };

  const onSelectQuizOption = async (optionId: string) => {
    setSelectedOption(optionId);
    if (!userId || isSubmittingQuiz) return;

    setIsSubmittingQuiz(true);
    try {
      const result = await submitLearnQuizAnswer(userId, optionId);
      const rewardLine =
        result.reward_coins > 0
          ? ` +${result.reward_xp} XP, +${result.reward_coins} coins`
          : ` +${result.reward_xp} XP`;
      setQuizFeedback(`${result.feedback}${rewardLine}`);
      await refreshHome();
    } catch (error) {
      setQuizFeedback(error instanceof Error ? error.message : 'Unable to submit answer');
    } finally {
      setIsSubmittingQuiz(false);
    }
  };

  const onClaimMission = async (mission: DailyMission) => {
    if (!userId || claimingMissionId || !mission.completed || mission.claimed) return;
    setClaimingMissionId(mission.id);
    try {
      await claimLearnMission(userId, mission.id);
      await refreshHome();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to claim mission');
    } finally {
      setClaimingMissionId(null);
    }
  };

  const quizOptions: QuizOption[] = homeData?.quiz_options ?? [];
  const userName = homeData?.user_name ?? 'Player';
  const player = homeData?.player_profile;
  const boss = homeData?.boss_challenge;
  const todayCard = homeData?.today_content;

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient colors={['#070915', '#101A2D', '#13212A']} style={styles.backgroundGlow} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Arena Ready, {userName}</Text>
            <Text style={styles.subtitle}>Play missions, earn XP, and master money skills.</Text>
          </View>
          <View style={styles.avatar}>
            <Ionicons name="game-controller-outline" size={22} color="#F8CF65" />
          </View>
        </View>

        {isLoading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color="#F8CF65" />
            <Text style={styles.loadingText}>Loading game arena...</Text>
          </View>
        ) : null}

        {loadError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        ) : null}

        {player ? (
          <LinearGradient colors={['#2A1358', '#1B2D72']} style={styles.playerCard}>
            <View style={styles.playerTop}>
              <Text style={styles.playerTitle}>Battle Pass</Text>
              <Text style={styles.levelBadge}>LV {player.level}</Text>
            </View>
            <View style={styles.playerStats}>
              <Text style={styles.playerStat}>XP {player.xp_in_level}/100</Text>
              <Text style={styles.playerStat}>Streak {player.streak_days}d</Text>
              <Text style={styles.playerStat}>Coins {player.coins}</Text>
            </View>
            <View style={styles.xpTrack}>
              <View style={[styles.xpFill, { width: `${player.xp_in_level}%` }]} />
            </View>
            {homeData?.daily_login_reward_claimed ? (
              <Text style={styles.rewardNotice}>Daily login bonus: +10 XP, +3 coins</Text>
            ) : null}
          </LinearGradient>
        ) : null}

        {boss ? (
          <View style={styles.bossCard}>
            <View style={styles.bossHeader}>
              <Ionicons name="flame-outline" size={18} color="#FFB86B" />
              <Text style={styles.bossTitle}>{boss.title}</Text>
            </View>
            <Text style={styles.bossDesc}>{boss.description}</Text>
            <View style={styles.bossTrack}>
              <View style={[styles.bossFill, { width: `${(boss.progress / Math.max(1, boss.target)) * 100}%` }]} />
            </View>
            <Text style={styles.bossMeta}>
              Progress {boss.progress}/{boss.target} | Reward +{boss.reward_xp} XP +{boss.reward_coins} coins
            </Text>
          </View>
        ) : null}

        {todayCard ? (
          <View style={styles.storyCard}>
            <View style={styles.storyTagRow}>
              <Text style={styles.storyTag}>Daily Lore</Text>
              <Text style={styles.storyDifficulty}>{todayCard.difficulty.toUpperCase()}</Text>
            </View>
            <Text style={styles.storyTitle}>{todayCard.title}</Text>
            <Text style={styles.storyHook}>{todayCard.hook}</Text>
            <Text style={styles.storyLesson}>{todayCard.lesson}</Text>
            <Text style={styles.storyAction}>Action: {todayCard.action}</Text>
          </View>
        ) : null}

        <LinearGradient colors={['#1A6445', '#1AAE83']} style={styles.quizCard}>
          <Text style={styles.quizTitle}>{homeData?.quiz_question ?? 'Daily Quiz'}</Text>
          <View style={styles.quizOptionsWrap}>
            {quizOptions.map((option) => {
              const isSelected = selectedOption === option.id;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[styles.quizOption, isSelected && styles.quizOptionSelected]}
                  onPress={() => {
                    void onSelectQuizOption(option.id);
                  }}
                  activeOpacity={0.9}
                >
                  <Text style={[styles.quizOptionText, isSelected && styles.quizOptionTextSelected]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {quizFeedback ? <Text style={styles.quizFeedback}>{quizFeedback}</Text> : null}
          {isSubmittingQuiz ? <Text style={styles.quizFeedback}>Checking answer...</Text> : null}
        </LinearGradient>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Quest Board</Text>
        </View>
        {(homeData?.daily_missions ?? []).map((mission) => (
          <View key={mission.id} style={styles.missionCard}>
            <View style={styles.missionHeader}>
              <Text style={styles.missionTitle}>{mission.title}</Text>
              <Text style={styles.missionReward}>+{mission.reward_xp} XP / +{mission.reward_coins} C</Text>
            </View>
            <Text style={styles.missionDesc}>{mission.description}</Text>
            <Text style={styles.missionProgress}>{mission.progress}/{mission.target}</Text>
            <TouchableOpacity
              style={[styles.missionBtn, (!mission.completed || mission.claimed) && styles.missionBtnDisabled]}
              disabled={!mission.completed || mission.claimed || claimingMissionId === mission.id}
              onPress={() => {
                void onClaimMission(mission);
              }}
            >
              <Text style={styles.missionBtnText}>
                {mission.claimed
                  ? 'Claimed'
                  : claimingMissionId === mission.id
                    ? 'Claiming...'
                    : mission.completed
                      ? 'Claim Reward'
                      : 'Locked'}
              </Text>
            </TouchableOpacity>
          </View>
        ))}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Top Players</Text>
        </View>
        {(homeData?.leaderboard ?? []).map((entry) => (
          <View key={`${entry.rank}-${entry.user_name}`} style={styles.leaderCard}>
            <Text style={styles.leaderRank}>#{entry.rank}</Text>
            <Text style={styles.leaderName}>{entry.user_name}</Text>
            <Text style={styles.leaderMeta}>LV {entry.level} | {entry.total_xp} XP</Text>
          </View>
        ))}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Campaigns</Text>
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
                  <Ionicons name={path.icon as any} size={18} color="#1A0A3E" />
                </View>
                <Text style={styles.pathwayTime}>{path.time_left}</Text>
              </View>
              <Text style={styles.pathwayTitle}>{path.title}</Text>
              <View style={styles.campaignTrack}>
                <View style={[styles.campaignFill, { width: `${path.progress}%` }]} />
              </View>
              <Text style={styles.progressText}>{path.progress}% complete</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <TouchableOpacity style={styles.lessonBtn} onPress={() => router.push('/learn/daily-dose')}>
          <Text style={styles.lessonBtnText}>Open Daily Lesson</Text>
          <Ionicons name="arrow-forward" size={16} color="#0A1325" />
        </TouchableOpacity>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Practice Zones</Text>
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
                <Ionicons name={tool.icon as any} size={20} color="#FFE3A0" />
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
    backgroundColor: '#060913',
  },
  backgroundGlow: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.9,
  },
  scrollView: { flex: 1 },
  contentContainer: {
    paddingHorizontal: 18,
    paddingTop: Platform.OS === 'android' ? 16 : 8,
    paddingBottom: 34,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  greeting: { color: '#F8FAFF', fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#9FB7D9', fontSize: 13, marginTop: 4 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#20153A',
    borderWidth: 1,
    borderColor: '#5D4D92',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#131A2F',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2D3450',
    padding: 12,
    marginBottom: 12,
  },
  loadingText: { color: '#CAD7F5', fontSize: 12, fontWeight: '600' },
  errorCard: {
    backgroundColor: '#4A1D2D',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#8B3653',
    padding: 12,
    marginBottom: 12,
  },
  errorText: { color: '#FFD7E2', fontSize: 12, fontWeight: '600' },
  playerCard: { borderRadius: 18, padding: 14, marginBottom: 14 },
  playerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  playerTitle: { color: '#F8EEFF', fontSize: 17, fontWeight: '800' },
  levelBadge: {
    color: '#1A112D',
    backgroundColor: '#F8CF65',
    fontWeight: '800',
    fontSize: 12,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  playerStats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginBottom: 8 },
  playerStat: { color: '#D6DBFF', fontSize: 12, fontWeight: '700' },
  xpTrack: { height: 8, backgroundColor: '#2C2A56', borderRadius: 999, overflow: 'hidden' },
  xpFill: { height: '100%', backgroundColor: '#F8CF65' },
  rewardNotice: { marginTop: 8, color: '#E7E9FF', fontSize: 12, fontWeight: '600' },
  bossCard: {
    backgroundColor: '#1A152B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#4B3A67',
    padding: 14,
    marginBottom: 14,
  },
  bossHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  bossTitle: { color: '#FFE5C0', fontSize: 15, fontWeight: '800' },
  bossDesc: { color: '#C8BFE0', fontSize: 12, lineHeight: 18, marginBottom: 8 },
  bossTrack: { height: 8, backgroundColor: '#30234A', borderRadius: 999, overflow: 'hidden' },
  bossFill: { height: '100%', backgroundColor: '#FFB86B' },
  bossMeta: { marginTop: 8, color: '#EAD9BA', fontSize: 11, fontWeight: '700' },
  storyCard: {
    backgroundColor: '#101E38',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A4A78',
    padding: 14,
    marginBottom: 14,
  },
  storyTagRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  storyTag: { color: '#9DD0FF', fontSize: 12, fontWeight: '800' },
  storyDifficulty: { color: '#F8CF65', fontSize: 11, fontWeight: '800' },
  storyTitle: { color: '#F1F7FF', fontSize: 18, fontWeight: '800', marginTop: 6 },
  storyHook: { color: '#BBD8FF', fontSize: 13, marginTop: 6 },
  storyLesson: { color: '#DCEBFF', fontSize: 13, lineHeight: 19, marginTop: 6 },
  storyAction: { color: '#9BE9D2', fontSize: 12, marginTop: 6, fontWeight: '700' },
  quizCard: { borderRadius: 18, padding: 16, marginBottom: 14 },
  quizTitle: { color: '#F4FFF9', fontSize: 19, fontWeight: '800', marginBottom: 12 },
  quizOptionsWrap: { gap: 9 },
  quizOption: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  quizOptionSelected: { backgroundColor: '#F3FFFC', borderColor: '#F3FFFC' },
  quizOptionText: { color: '#EEFFF9', fontSize: 13, fontWeight: '700' },
  quizOptionTextSelected: { color: '#095E52' },
  quizFeedback: { marginTop: 10, color: '#F2FFF8', fontSize: 12, fontWeight: '700' },
  sectionHeaderRow: { marginBottom: 10, marginTop: 2 },
  sectionTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  missionCard: {
    backgroundColor: '#131A2F',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2E3657',
    padding: 12,
    marginBottom: 10,
  },
  missionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  missionTitle: { color: '#F7F9FF', fontSize: 14, fontWeight: '800' },
  missionReward: { color: '#F8CF65', fontSize: 11, fontWeight: '800' },
  missionDesc: { color: '#BBC7E6', fontSize: 12, marginTop: 4 },
  missionProgress: { color: '#8FE8CB', fontSize: 11, marginTop: 4, marginBottom: 8, fontWeight: '700' },
  missionBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#F8CF65',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  missionBtnDisabled: { opacity: 0.5 },
  missionBtnText: { color: '#111724', fontSize: 12, fontWeight: '800' },
  leaderCard: {
    backgroundColor: '#151226',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A335E',
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  leaderRank: { color: '#F8CF65', width: 34, fontSize: 14, fontWeight: '800' },
  leaderName: { color: '#EEF2FF', flex: 1, fontSize: 14, fontWeight: '700' },
  leaderMeta: { color: '#AEB9DB', fontSize: 12, fontWeight: '700' },
  pathwayRow: { gap: 12, paddingBottom: 6, marginBottom: 14 },
  pathwayCard: {
    width: 220,
    backgroundColor: '#131A2F',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2D3354',
    padding: 14,
  },
  pathwayTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  pathwayIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F8CF65',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pathwayTime: { color: '#A4B6E9', fontSize: 12, fontWeight: '700' },
  pathwayTitle: { color: '#F3F7FF', fontSize: 16, fontWeight: '800', marginBottom: 12 },
  campaignTrack: { height: 8, backgroundColor: '#273151', borderRadius: 999, overflow: 'hidden' },
  campaignFill: { height: '100%', backgroundColor: '#8FE8CB' },
  progressText: { marginTop: 8, color: '#95DCC8', fontSize: 12, fontWeight: '700' },
  lessonBtn: {
    backgroundColor: '#F8CF65',
    borderRadius: 999,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 18,
  },
  lessonBtnText: { color: '#0A1325', fontSize: 13, fontWeight: '800' },
  toolsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 14,
  },
  toolItem: {
    width: '47%',
    backgroundColor: '#151A2E',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#313A60',
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  toolIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#2A2044',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  toolLabel: { color: '#F3F7FF', fontSize: 14, fontWeight: '800', marginBottom: 3 },
  toolSubLabel: { color: '#A4B0CF', fontSize: 11, textAlign: 'center', lineHeight: 15 },
});
