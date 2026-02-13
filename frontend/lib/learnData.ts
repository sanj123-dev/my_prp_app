export type LearnPathway = {
  slug: 'budgeting-basics' | 'investing-101' | 'debt-management';
  title: string;
  progress: number;
  timeLeft: string;
  icon: 'wallet-outline' | 'trending-up-outline' | 'shield-checkmark-outline';
  summary: string;
  steps: string[];
};

export const LEARN_PATHWAYS: LearnPathway[] = [
  {
    slug: 'budgeting-basics',
    title: 'Budgeting Basics',
    progress: 65,
    timeLeft: '5 min left',
    icon: 'wallet-outline',
    summary: 'Build a realistic plan you can stick with every week.',
    steps: [
      'Track spending by need, want, and debt.',
      'Set a weekly spend cap for variable categories.',
      'Review every Sunday and adjust with one small improvement.',
    ],
  },
  {
    slug: 'investing-101',
    title: 'Investing 101',
    progress: 20,
    timeLeft: '12 min left',
    icon: 'trending-up-outline',
    summary: 'Understand risk, compounding, and long-term discipline.',
    steps: [
      'Learn risk vs return with simple examples.',
      'Compare diversified funds vs single stock risk.',
      'Set a monthly auto-invest amount and hold long term.',
    ],
  },
  {
    slug: 'debt-management',
    title: 'Debt Management',
    progress: 45,
    timeLeft: '8 min left',
    icon: 'shield-checkmark-outline',
    summary: 'Pay down high-interest debt without burning out.',
    steps: [
      'List balances and interest rates from highest to lowest.',
      'Choose avalanche or snowball method for your personality.',
      'Automate your minimum + one extra payment each cycle.',
    ],
  },
];

export const LEARN_TOOLS = [
  {
    label: 'Simulator',
    icon: 'stats-chart-outline' as const,
    route: '/learn/simulator',
    blurb: 'Practice with virtual money before real decisions.',
  },
  {
    label: 'Glossary',
    icon: 'book-outline' as const,
    route: '/learn/glossary',
    blurb: 'Understand terms fast with plain language.',
  },
  {
    label: 'Watchlist',
    icon: 'eye-outline' as const,
    route: '/learn/watchlist',
    blurb: 'Follow assets and connect them to lessons.',
  },
  {
    label: 'Pitfalls',
    icon: 'warning-outline' as const,
    route: '/learn/pitfalls',
    blurb: 'Avoid common emotional money mistakes.',
  },
];
