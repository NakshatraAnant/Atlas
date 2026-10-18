// Breached-password check (PRD ACC-01). Offline list of the most common leaked passwords plus
// structural rules. The production plan is the k-anonymity range API of a breach corpus behind
// a feature flag; until it is configured, this offline check is the enforced control.

const COMMON = new Set(
  `123456 123456789 12345678 password qwerty123 qwerty 1q2w3e4r 12345 111111 123123 1234567890 1234567 password1 abc123 iloveyou 000000 qwertyuiop
   123321 654321 666666 121212 777777 987654321 1qaz2wsx zaq12wsx password123 passw0rd admin admin123 welcome welcome1 welcome123 letmein letmein1
   monkey dragon football baseball sunshine princess master shadow superman michael charlie jordan23 trustno1 hello123 freedom whatever starwars
   iloveyou1 india123 india@123 india12345 bharat123 mumbai123 delhi123 bangalore chennai123 pune1234 kolkata123 hyderabad sachin cricket
   cricket123 krishna123 ganesh123 sairam123 omsairam jaihind jaimatadi rahul123 priya123 qwerty12345 asdfghjkl zxcvbnm asdf1234 qazwsx123
   1234qwer q1w2e3r4 q1w2e3r4t5 aa123456 a123456789 123qwe 123abc abcd1234 abcdef123 Passw0rd! P@ssw0rd p@ssword p@ssw0rd123 Password@123
   Password123 Password1 Welcome@123 Admin@123 India@1234 Qwerty@123 changeme changeme123 default secret secret123 test1234 testtest
   1111111111 0000000000 1231231231 9876543210 1212121212 5555555555 stockmarket investing123 sensex123 nifty50 nifty123 trading123`
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.toLowerCase()),
);

export interface PasswordCheck {
  ok: boolean;
  reason?: string;
}

export function checkPassword(password: string, email?: string): PasswordCheck {
  if (password.length < 10) return { ok: false, reason: 'Use at least 10 characters.' };
  if (password.length > 200) return { ok: false, reason: 'Use at most 200 characters.' };
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return { ok: false, reason: 'This password appears in lists of breached passwords. Choose another.' };
  if (/^(.)\1+$/.test(password)) return { ok: false, reason: 'Avoid repeating a single character.' };
  if (/^(?:0123456789|1234567890|abcdefghij|qwertyuiop)/i.test(password)) return { ok: false, reason: 'Avoid keyboard or number sequences.' };
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return { ok: false, reason: 'Do not include your email address in the password.' };
  return { ok: true };
}
