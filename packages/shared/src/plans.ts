// Plan catalogue defaults from PRD §4.3. The database (app.plans / app.plan_entitlements)
// is the runtime source of truth (BIL-01); these values seed it and type the API.

export type PlanCode = 'free' | 'plus' | 'pro';
export const PLAN_CODES: PlanCode[] = ['free', 'plus', 'pro'];

export type EntitlementKey =
  | 'full_profiles_per_month'
  | 'history_years'
  | 'history_quarters'
  | 'peer_edit_max'
  | 'peer_sets_saved'
  | 'ai_questions_per_month'
  | 'screener_filters_max'
  | 'saved_screens'
  | 'backtests_per_month'
  | 'backtest_universe_strategies'
  | 'rule_builder'
  | 'watchlists'
  | 'watchlist_size'
  | 'alerts_active'
  | 'notes'
  | 'pdf_exports_per_month'
  | 'csv_export'
  | 'csv_exports_per_month'
  | 'learning_all_lessons'
  | 'support_reply_business_days'
  | 'support_priority';

/** -1 means unlimited. Booleans are stored as 0/1. */
export type Entitlements = Record<EntitlementKey, number>;

export const UNLIMITED = -1;

export interface PlanDefault {
  name: string;
  priceInrMonthly: number;
  supportNote: string;
  entitlements: Entitlements;
}

export const DEFAULT_PLANS: Record<PlanCode, PlanDefault> = {
  free: {
    name: 'Free',
    priceInrMonthly: 0,
    supportNote: 'Help centre; email reply in 3 business days',
    entitlements: {
      full_profiles_per_month: 10, history_years: 3, history_quarters: 4, peer_edit_max: 0, peer_sets_saved: 0,
      ai_questions_per_month: 10, screener_filters_max: 10, saved_screens: 1, backtests_per_month: 3,
      backtest_universe_strategies: 0, rule_builder: 0, watchlists: 1, watchlist_size: 10, alerts_active: 0,
      notes: 5, pdf_exports_per_month: 0, csv_export: 0, csv_exports_per_month: 0, learning_all_lessons: 0,
      support_reply_business_days: 3, support_priority: 0,
    },
  },
  plus: {
    name: 'Plus',
    priceInrMonthly: 499,
    supportNote: 'Email reply in 1 business day',
    entitlements: {
      full_profiles_per_month: UNLIMITED, history_years: 10, history_quarters: 12, peer_edit_max: 5, peer_sets_saved: 0,
      ai_questions_per_month: 60, screener_filters_max: UNLIMITED, saved_screens: 10, backtests_per_month: 20,
      backtest_universe_strategies: 0, rule_builder: 0, watchlists: 5, watchlist_size: 50, alerts_active: 25,
      notes: UNLIMITED, pdf_exports_per_month: 10, csv_export: 0, csv_exports_per_month: 0, learning_all_lessons: 1,
      support_reply_business_days: 1, support_priority: 0,
    },
  },
  pro: {
    name: 'Pro Research',
    priceInrMonthly: 1499,
    supportNote: 'Email reply in 1 business day, priority queue',
    entitlements: {
      full_profiles_per_month: UNLIMITED, history_years: UNLIMITED, history_quarters: UNLIMITED, peer_edit_max: 10, peer_sets_saved: UNLIMITED,
      ai_questions_per_month: 200, screener_filters_max: UNLIMITED, saved_screens: 50, backtests_per_month: 100,
      backtest_universe_strategies: 1, rule_builder: 1, watchlists: 20, watchlist_size: 100, alerts_active: 100,
      notes: UNLIMITED, pdf_exports_per_month: 40, csv_export: 1, csv_exports_per_month: 20, learning_all_lessons: 1,
      support_reply_business_days: 1, support_priority: 1,
    },
  },
};

export const PLAN_RANK: Record<PlanCode, number> = { free: 0, plus: 1, pro: 2 };
