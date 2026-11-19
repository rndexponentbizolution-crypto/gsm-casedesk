import {
  MAIN_MENU,
  OTHER_MENU,
  PIN_RESET_PHRASES,
  RESTART_PHRASES,
  type MenuOption,
} from './query-types';

/**
 * Pure helpers for the WhatsApp entry bot (the "WA - Entry Router",
 * "Pin Reset Flow initiation", "pin reset end" and "Proactive Conversation
 * reset" flows). The stateful orchestration lives in AppService.
 */

export type BotState =
  'IDLE' | 'MENU' | 'OTHER_MENU' | 'AWAITING_PIN_DETAILS' | 'WITH_AGENT';

export const BOT_STATES: BotState[] = [
  'IDLE',
  'MENU',
  'OTHER_MENU',
  'AWAITING_PIN_DETAILS',
  'WITH_AGENT',
];

/** States where the bot (not a person) is handling the conversation. */
export const BOT_HANDLED: BotState[] = [
  'MENU',
  'OTHER_MENU',
  'AWAITING_PIN_DETAILS',
];

const normalise = (value: string) =>
  value
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Resolve a menu choice from a WhatsApp interactive reply id, the option
 * title typed out, or its number ("1" … "6").
 */
export function matchOption(
  options: MenuOption[],
  input: { text?: string; replyId?: string },
): MenuOption | null {
  if (input.replyId) {
    const byId = options.find((option) => option.id === input.replyId);
    if (byId) return byId;
  }
  const text = normalise(input.text ?? '');
  if (!text) return null;
  const byNumber = /^\d+$/.test(text) ? options[Number(text) - 1] : undefined;
  if (byNumber) return byNumber;
  return (
    options.find((option) => normalise(option.title) === text) ??
    // Tolerate a little extra text around the title, e.g. "pin reset please".
    options.find((option) => text.includes(normalise(option.title))) ??
    null
  );
}

export function isPinResetPhrase(text?: string) {
  const value = normalise(text ?? '');
  return PIN_RESET_PHRASES.some((phrase) => value.includes(phrase));
}

export function isRestartPhrase(text?: string) {
  const value = normalise(text ?? '');
  return RESTART_PHRASES.includes(value);
}

/** Pull a Zambian MSISDN out of free text, e.g. "0971234567" or "+260 97 123 4567". */
export function extractMsisdn(text?: string): string | null {
  const compact = (text ?? '').replace(/[\s-]/g, '');
  const match = compact.match(/(?:\+?260|0)?(9[5-7]\d{7}|7[5-7]\d{7})/);
  return match ? `+260${match[1]}` : null;
}

export const BOT_TEXT = {
  welcome: `Y'ello, welcome to GSM Support.
Kindly select your query type below so I can assist you correctly.`,
  menuPrompt: 'Please select your query type.',
  otherPrompt: 'Please select.',
  pinDetails: `Please provide the following and I will process the PIN reset for you:

1. Phone number
2. Pictures of NRC (front and back)
3. Live facial capture`,
};

export const MENUS = { main: MAIN_MENU, other: OTHER_MENU };

export interface InteractiveList {
  type: 'list';
  button: string;
  options: MenuOption[];
}

export const listOf = (options: MenuOption[]): InteractiveList => ({
  type: 'list',
  button: 'Select',
  options,
});
