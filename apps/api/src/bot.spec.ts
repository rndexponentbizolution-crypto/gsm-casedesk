import {
  extractMsisdn,
  isPinResetPhrase,
  isRestartPhrase,
  matchOption,
  MENUS,
} from './bot';
import { RESPONSES } from './responses';

describe('bot matching', () => {
  it('matches a menu option by interactive reply id, number or title', () => {
    expect(matchOption(MENUS.main, { replyId: 'TIER_UPGRADE' })?.id).toBe(
      'TIER_UPGRADE',
    );
    expect(matchOption(MENUS.main, { text: '1' })?.id).toBe('PIN_RESET');
    expect(matchOption(MENUS.main, { text: 'Change of Details' })?.id).toBe(
      'CHANGE_OF_DETAILS',
    );
    expect(matchOption(MENUS.main, { text: 'other' })?.id).toBe('MENU_OTHER');
    expect(matchOption(MENUS.main, { text: 'what is this' })).toBeNull();
    expect(matchOption(MENUS.main, { text: '9' })).toBeNull();
  });

  it('recognises PIN reset phrases from the initiation flow', () => {
    expect(isPinResetPhrase('Customer PIN reset please')).toBe(true);
    expect(isPinResetPhrase('forgot pin')).toBe(true);
    expect(isPinResetPhrase('SIM swap')).toBe(false);
  });

  it('recognises restart phrases from the entry router', () => {
    expect(isRestartPhrase('Talk to human')).toBe(true);
    expect(isRestartPhrase('you there?')).toBe(true);
    expect(isRestartPhrase('pin reset')).toBe(false);
  });

  it('extracts Zambian MSISDNs in common formats', () => {
    expect(extractMsisdn('Number 0971234567')).toBe('+260971234567');
    expect(extractMsisdn('+260 96 123 4567')).toBe('+260961234567');
    expect(extractMsisdn('260761234567')).toBe('+260761234567');
    expect(extractMsisdn('no number here')).toBeNull();
  });
});

describe('standard responses', () => {
  it('have unique ids and non-empty bodies', () => {
    const ids = RESPONSES.map((response) => response.id);
    expect(new Set(ids).size).toBe(ids.length);
    RESPONSES.forEach((response) => expect(response.body.trim()).not.toBe(''));
  });

  it('give every escalation a subject and SLA', () => {
    RESPONSES.filter((response) => response.effect.kind === 'escalate').forEach(
      (response) => {
        const effect = response.effect as { subject: string; slaHours: number };
        expect(effect.subject).toBeTruthy();
        expect(effect.slaHours).toBeGreaterThan(0);
      },
    );
  });
});
