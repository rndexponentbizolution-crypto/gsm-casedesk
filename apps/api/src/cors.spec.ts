import { allowedOrigins } from './cors';

describe('allowedOrigins', () => {
  it('strips trailing slashes so browser Origin headers match', () => {
    expect(allowedOrigins('https://gsm-casedesk.vercel.app/')).toEqual([
      'https://gsm-casedesk.vercel.app',
    ]);
  });

  it('accepts a comma-separated list', () => {
    expect(
      allowedOrigins(' https://a.example.com/ , http://localhost:3000'),
    ).toEqual(['https://a.example.com', 'http://localhost:3000']);
  });

  it('falls back to local development when unset', () => {
    expect(allowedOrigins('')).toEqual(['http://localhost:3000']);
  });
});
