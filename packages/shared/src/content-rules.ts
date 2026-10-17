// Prohibited and controlled language in system-generated text (PRD §10.2, CPL-02).
// The checker is deliberately conservative: a false positive holds a briefing or
// triggers regeneration, which is cheaper than publishing a recommendation.

export type RuleCategory = 'recommendation' | 'target_forecast' | 'guarantee_hype' | 'causal_certainty' | 'urgency';

export interface ContentViolation {
  category: RuleCategory;
  match: string;
  index: number;
  rule: string;
  /** block = must not publish; rewrite = allowed only with linked evidence, otherwise rewrite as hypothesis. */
  action: 'block' | 'rewrite';
}

interface Rule {
  category: RuleCategory;
  id: string;
  pattern: RegExp;
  action: 'block' | 'rewrite';
}

// Phrases that contain prohibited words but are descriptive and allowed.
const ALLOWED_PHRASES: RegExp[] = [
  /\bbuy[- ]and[- ]hold\b/gi,
  /\bbuy[- ]?backs?\b/gi,
  /\bbuy(?:ing)? and sell(?:ing)? (?:costs?|charges?|side)\b/gi,
  /\b(?:buy|sell) side\b/gi,
  /\bbuy or sell\b/gi, // used in the standard disclosure: "offer or solicitation to buy or sell"
  /\bto buy, sell\b/gi,
  /\bbuy\/sell\/hold\b/gi, // used when explaining what ATLAS does not do
  /\bexit (?:rule|rules|condition|conditions|signal on the close|price|prices|at the last traded price)\b/gi,
  /\bentry and exit\b/gi,
  /\bholding(?:s)?\b/gi,
  /\bshareholding\b/gi,
  /\bhold(?:s)? (?:the )?position\b/gi,
  /\bhypothetical (?:buy|sell)\b/gi,
  /\b(?:simulated|historical) (?:buy|sell)s?\b/gi,
  /\bnot (?:a )?(?:recommendation|target|forecast)s?\b/gi,
  /\bdoes not (?:give|provide) recommendations\b/gi,
  /\bno (?:price )?targets?\b/gi,
  /\brisk-free rate\b/gi,
];

const RULES: Rule[] = [
  // Recommendations directed at a security or portfolio
  { category: 'recommendation', id: 'REC-VERB', action: 'block', pattern: /\b(?:strong(?:ly)? )?(?:buy|sell|accumulate)\b/gi },
  { category: 'recommendation', id: 'REC-ADVISE', action: 'block', pattern: /\b(?:you|investors|one) (?:should|must|could|may want to|might want to) (?:buy|sell|hold|accumulate|exit|add|book|avoid|switch)\b/gi },
  { category: 'recommendation', id: 'REC-WE-RECOMMEND', action: 'block', pattern: /\b(?:we|atlas) (?:recommend|suggest|advise)s?\b/gi },
  { category: 'recommendation', id: 'REC-HOLD', action: 'block', pattern: /\b(?:continue to |keep )?hold(?:ing)? (?:the|this|your) (?:stock|share|shares|position)\b/gi },
  { category: 'recommendation', id: 'REC-DIPS', action: 'block', pattern: /\badd on dips\b/gi },
  { category: 'recommendation', id: 'REC-BOOK', action: 'block', pattern: /\bbook (?:partial )?profits?\b/gi },
  { category: 'recommendation', id: 'REC-GOOD-TIME', action: 'block', pattern: /\b(?:good|right|best) time to (?:invest|enter|exit|buy|sell)\b/gi },
  { category: 'recommendation', id: 'REC-RATING', action: 'block', pattern: /\b(?:outperform|underperform|overweight|underweight) rating\b/gi },
  { category: 'recommendation', id: 'REC-BEST-STOCKS', action: 'block', pattern: /\bbest (?:stocks?|shares?) to (?:buy|own|invest)\b/gi },
  // Targets and forecasts
  { category: 'target_forecast', id: 'TGT-PRICE', action: 'block', pattern: /\b(?:target price|price target|fair value of|intrinsic value of)\b/gi },
  { category: 'target_forecast', id: 'TGT-WILL', action: 'block', pattern: /\b(?:will|is going to|is expected to|is likely to) (?:reach|rise|fall|hit|touch|double|rally|crash|climb|drop|outperform|underperform)\b/gi },
  { category: 'target_forecast', id: 'TGT-UPSIDE', action: 'block', pattern: /\b(?:upside|downside) (?:of|potential)\b/gi },
  // Guarantees and hype — blocked everywhere including marketing
  { category: 'guarantee_hype', id: 'HYPE', action: 'block', pattern: /\b(?:guaranteed?|guarantees|sure[- ]shot|risk[- ]free|multibaggers?|jackpot|can't lose|cannot lose|assured returns?)\b/gi },
  // Causal certainty — allowed only with linked evidence
  { category: 'causal_certainty', id: 'CAUSE', action: 'rewrite', pattern: /\b(?:fell|rose|dropped|declined|gained|jumped|slumped|rallied|moved) because\b|\bwas caused by\b|\bdue to\b|\bdriven by\b|\bas a result of\b/gi },
  // Urgency — blocked in product and upgrade copy
  { category: 'urgency', id: 'URGENCY', action: 'block', pattern: /\b(?:act now|last chance|don'?t miss|hurry|limited time|only \d+ left|offer ends)\b/gi },
];

function maskAllowed(text: string): string {
  let masked = text;
  for (const re of ALLOWED_PHRASES) {
    masked = masked.replace(re, (m) => ' '.repeat(m.length));
  }
  return masked;
}

export interface CheckOptions {
  /** When true, causal phrases are accepted because the caller linked timing/causal evidence. */
  causalEvidenceLinked?: boolean;
}

export function checkContent(text: string, opts: CheckOptions = {}): ContentViolation[] {
  const masked = maskAllowed(text);
  const out: ContentViolation[] = [];
  for (const rule of RULES) {
    if (rule.category === 'causal_certainty' && opts.causalEvidenceLinked) continue;
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(masked)) !== null) {
      out.push({ category: rule.category, match: text.slice(m.index, m.index + m[0].length), index: m.index, rule: rule.id, action: rule.action });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

export function isContentClean(text: string, opts: CheckOptions = {}): boolean {
  return checkContent(text, opts).length === 0;
}

/** Rewrites a causal sentence into hypothesis language (MKT-11). */
export function toHypothesisLanguage(sentence: string): string {
  const trimmed = sentence.trim().replace(/\.$/, '');
  return `A possible explanation, not shown to be the cause: ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}.`;
}
