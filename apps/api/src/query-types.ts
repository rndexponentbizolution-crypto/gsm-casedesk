/**
 * Query types and SLAs, from the GSM BO SOP pack:
 * - "WA - Entry Router" flow (menu options and tags)
 * - "Back Office Query Escalation Guidelines" (SLA table)
 * - "GSM AHD Query Types" (first-level vs escalation)
 * - "GSM AHD WhatsApp SOP" (WhatsApp is for PIN resets only; everything else goes to email)
 */

export const GSM_BACKOFFICE_EMAIL = 'gsm.backoffice@exponentbizolution.org';
export const PIN_RESET_BALANCE_THRESHOLD_ZMW = 5000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type QueryTypeKey =
  | 'PIN_RESET'
  | 'PIN_RESET_ABOVE_THRESHOLD'
  | 'MOMO_PAY_DOWNGRADE'
  | 'TIER_UPGRADE'
  | 'CHANGE_OF_DETAILS'
  | 'MOMO_ACTIVATION'
  | 'MOMO_UNBLOCKING'
  | 'SIM_SWAP_APPROVAL'
  | 'MOMO_APPROVAL'
  | 'SALARY_WALLET'
  | 'REVERSAL'
  | 'SIM_VERIFICATION'
  | 'OTHER';

export interface QueryType {
  key: QueryTypeKey;
  label: string;
  /** Tag applied by the Entry Router flow */
  tag: string;
  /** WhatsApp channel handles it directly (PIN reset only); others are redirected to email */
  handledOnWhatsApp: boolean;
  /** Expected resolution time, from the escalation guidelines */
  slaMs: number | null;
  /** First-level (closed by the team) vs escalated to MoMo back office/partners */
  level: 'FIRST' | 'ESCALATED';
}

export const QUERY_TYPES: Record<QueryTypeKey, QueryType> = {
  PIN_RESET: {
    key: 'PIN_RESET',
    label: 'PIN reset',
    tag: 'query_pin_reset',
    handledOnWhatsApp: true,
    slaMs: 5 * MINUTE,
    level: 'FIRST',
  },
  PIN_RESET_ABOVE_THRESHOLD: {
    key: 'PIN_RESET_ABOVE_THRESHOLD',
    label: 'PIN reset above threshold',
    tag: 'query_pin_reset_above_threshold',
    handledOnWhatsApp: false,
    slaMs: 24 * HOUR,
    level: 'ESCALATED',
  },
  MOMO_PAY_DOWNGRADE: {
    key: 'MOMO_PAY_DOWNGRADE',
    label: 'MoMo pay downgrade',
    tag: 'query_momo_downgrade',
    handledOnWhatsApp: false,
    slaMs: 24 * HOUR,
    level: 'ESCALATED',
  },
  TIER_UPGRADE: {
    key: 'TIER_UPGRADE',
    label: 'Tier upgrade',
    tag: 'query_tier_upgrade',
    handledOnWhatsApp: false,
    slaMs: null,
    level: 'ESCALATED',
  },
  CHANGE_OF_DETAILS: {
    key: 'CHANGE_OF_DETAILS',
    label: 'Change of details',
    tag: 'query_change_of_details',
    handledOnWhatsApp: false,
    slaMs: 72 * HOUR,
    level: 'FIRST',
  },
  MOMO_ACTIVATION: {
    key: 'MOMO_ACTIVATION',
    label: 'MoMo activation',
    tag: 'query_momo_activation',
    handledOnWhatsApp: false,
    slaMs: null,
    level: 'ESCALATED',
  },
  MOMO_UNBLOCKING: {
    key: 'MOMO_UNBLOCKING',
    label: 'MoMo unblocking',
    tag: 'query_momo_unblocking',
    handledOnWhatsApp: false,
    slaMs: 24 * HOUR,
    level: 'ESCALATED',
  },
  SIM_SWAP_APPROVAL: {
    key: 'SIM_SWAP_APPROVAL',
    label: 'SIM swap approval',
    tag: 'query_sim_swap_approval',
    handledOnWhatsApp: false,
    slaMs: 72 * HOUR,
    level: 'ESCALATED',
  },
  MOMO_APPROVAL: {
    key: 'MOMO_APPROVAL',
    label: 'MoMo approval',
    tag: 'query_momo_approval',
    handledOnWhatsApp: false,
    slaMs: null,
    level: 'ESCALATED',
  },
  SALARY_WALLET: {
    key: 'SALARY_WALLET',
    label: 'Salary wallet',
    tag: 'query_salary_wallet',
    handledOnWhatsApp: false,
    slaMs: null,
    level: 'ESCALATED',
  },
  REVERSAL: {
    key: 'REVERSAL',
    label: 'Reversal',
    tag: 'query_reversal',
    handledOnWhatsApp: false,
    slaMs: null,
    level: 'ESCALATED',
  },
  SIM_VERIFICATION: {
    key: 'SIM_VERIFICATION',
    label: 'SIM verification',
    tag: 'query_sim_verification',
    handledOnWhatsApp: false,
    slaMs: 24 * HOUR,
    level: 'FIRST',
  },
  OTHER: {
    key: 'OTHER',
    label: 'Other',
    tag: 'query_other',
    handledOnWhatsApp: false,
    slaMs: null,
    level: 'ESCALATED',
  },
};

export const isQueryType = (value: unknown): value is QueryTypeKey =>
  typeof value === 'string' && value in QUERY_TYPES;

/** A WhatsApp list option. WhatsApp limits list row titles to 24 characters. */
export interface MenuOption {
  id: string;
  title: string;
}

/** Main menu from the "WA - Entry Router" flow decision node. */
export const MAIN_MENU: MenuOption[] = [
  { id: 'PIN_RESET', title: 'PIN reset' },
  { id: 'MOMO_PAY_DOWNGRADE', title: 'MoMo pay downgrade' },
  { id: 'TIER_UPGRADE', title: 'Tier upgrade' },
  { id: 'CHANGE_OF_DETAILS', title: 'Change of details' },
  { id: 'MOMO_ACTIVATION', title: 'MoMo activation' },
  { id: 'MENU_OTHER', title: 'Other' },
];

/** "Other" sub-menu from the same flow. */
export const OTHER_MENU: MenuOption[] = [
  { id: 'MOMO_UNBLOCKING', title: 'MoMo unblocking' },
  { id: 'SIM_SWAP_APPROVAL', title: 'Sim swap approval' },
  { id: 'MOMO_APPROVAL', title: 'MoMo approval' },
  { id: 'SALARY_WALLET', title: 'Salary wallet' },
  { id: 'REVERSAL', title: 'Reversal' },
];

/** Phrases from the "Pin Reset Flow initiation" trigger that jump straight to a PIN reset. */
export const PIN_RESET_PHRASES = [
  'reset pin',
  'pin reset',
  'forgot mobile money pin',
  'change pin',
  'locked out of account',
  'customer pin reset',
  'pin not working',
  'forgot pin',
];

/** Phrases from the Entry Router "visitor says" node that restart the menu. */
export const RESTART_PHRASES = [
  'i want to talk to human',
  'human',
  'talk to human',
  'test',
  'trial',
  'you there',
  'ati how',
  'menu',
  'hi',
  'hello',
];

/** No contact for this long re-opens the menu ("Proactive Conversation reset" flow). */
export const CONVERSATION_RESET_MS = 24 * HOUR;
