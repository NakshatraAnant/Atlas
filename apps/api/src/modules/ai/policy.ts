// Intent and policy check (PRD AIA-06, AIA-12; Blueprint §8.2). Rule-based, deterministic and
// conservative: anything that asks ATLAS what to do with a security gets the policy-safe response.

export type Intent = 'advice' | 'injection' | 'abusive' | 'off_topic' | 'research';

export interface PolicyResult {
  intent: Intent;
  reasons: string[];
}

const ADVICE: RegExp[] = [
  /\bshould\s+(?:i|we|one)\s+(?:buy|sell|hold|invest|exit|enter|accumulate|add|book|keep|switch|average|short|go\s+long)\b/i,
  /\b(?:is|are)\s+\S+(?:\s+\S+){0,3}\s+(?:a\s+)?(?:good|great|safe|bad|right)\s+(?:buy|sell|investment|bet|stock|pick|time)\b/i,
  /\b(?:buy|sell|hold)\s+(?:or|\/)\s+(?:sell|hold|buy|not)\b/i,
  /\b(?:worth|good\s+time\s+to)\s+(?:buying|selling|investing|buy|sell|invest)\b/i,
  /\b(?:target\s+price|price\s+target|fair\s+value|intrinsic\s+value|upside|downside\s+target)\b/i,
  /\b(?:will|would|could|can)\s+(?:it|the\s+stock|the\s+share|the\s+price|\S+\s+(?:stock|shares?))\s+(?:go\s+up|go\s+down|rise|fall|double|triple|crash|rally|reach|hit|touch|recover|outperform)\b/i,
  /\b(?:where|how\s+high|how\s+low|how\s+far)\s+(?:will|would|can)\b.*\b(?:go|reach|trade|end)\b/i,
  /\b(?:predict|forecast|projection)\b.*\b(?:price|stock|share|return|market|nifty|sensex|index)\b/i,
  /\b(?:tips?|calls?|picks?|recommend(?:ation)?s?|suggest(?:ion)?s?)\b.*\b(?:stock|share|buy|sell|portfolio|invest|trade)\b/i,
  /\b(?:which|what)\s+(?:stocks?|shares?|companies)\s+(?:should|to|can|must|do\s+you\s+recommend)\b/i,
  /\b(?:best|top)\s+(?:stocks?|shares?|picks?|companies)\s+(?:to|for)\s+(?:buy|invest|hold|own)\b/i,
  /\b(?:multibagger|sure[- ]?shot|jackpot|guaranteed\s+returns?|risk[- ]?free\s+returns?)\b/i,
  /\b(?:how\s+much|what\s+percent(?:age)?)\s+(?:should|of\s+my)\b.*\b(?:invest|allocate|put|portfolio|money)\b/i,
  /\b(?:allocat\w*|rebalance\s+my|my\s+portfolio)\b/i,
  /\b(?:stop[- ]?loss|entry\s+point|exit\s+point|when\s+to\s+(?:buy|sell|exit|enter))\b/i,
  /\b(?:undervalued|overvalued|cheap|expensive)\s*\?/i,
  /\bis\s+(?:now|today|this)\s+(?:the|a)\s+(?:right|good|best)\s+time\b/i,
  /\b(?:add\s+on\s+dips|book\s+profits?|average\s+(?:down|out))\b/i,
  /\b(?:intraday|f&o|options?)\s+(?:tip|call|trade|strategy)\b/i,
  /\bwhat\s+(?:would|will)\s+you\s+(?:do|buy|choose)\b/i,
  /\b(?:give|tell)\s+me\s+(?:a\s+)?(?:stock|share|tip|call|pick)\b/i,
  // Hinglish and transliterated phrasing
  /\b(?:kharid(?:u|oon|na|ein|e|lo|o)?|khareed\w*|bech(?:u|oon|na|ein|e|do|o|dun)?|le\s+lu|le\s+lo|lena\s+chahiye|bechna\s+chahiye|rakh(?:u|na|oon)?\s+(?:ya|ki)|hold\s+karu|exit\s+karu|invest\s+karu|paisa\s+lagau|paise\s+lagau|lagana\s+chahiye)\b/i,
  /\b(?:kitna|kahan\s+tak)\s+(?:jayega|jaega|badhega|girega|chalega|upar|neeche)\b/i,
  /\b(?:target\s+kya|tip\s+do|tips\s+do|koi\s+(?:accha|achha)\s+(?:stock|share)|kaunsa\s+(?:stock|share))\b/i,
  /\b(?:upar\s+jayega|neeche\s+jayega|double\s+hoga|multibagger\s+hai)\b/i,
];

const INJECTION: RegExp[] = [
  /\bignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|rules|prompts?)\b/i,
  /\b(?:system\s+prompt|developer\s+message|hidden\s+instructions)\b/i,
  /\byou\s+are\s+now\s+(?:a|an|in)\b/i,
  /\b(?:jailbreak|DAN\s+mode|developer\s+mode|act\s+as\s+(?:a|an)\s+(?:financial\s+advis[eo]r|tipster|broker))\b/i,
  /\b(?:pretend|roleplay|role-play)\s+(?:you|that\s+you)\b/i,
  /\bdisregard\s+(?:your|the)\s+(?:rules|guidelines|policy|instructions)\b/i,
  /\b(?:override|bypass)\s+(?:your|the)\s+(?:rules|policy|restrictions|guardrails)\b/i,
  /<\/?(?:system|instructions?|admin)>/i,
];

const ABUSIVE = /\b(?:idiot|stupid\s+bot|f+u+c+k|shit|bastard|chutiya|bhenchod|madarchod)\b/i;
const OFF_TOPIC = /\b(?:recipe|weather|football\s+score|cricket\s+score|movie|song|poem|joke|write\s+(?:me\s+)?(?:an?\s+)?(?:essay|story|code)|translate|homework|bitcoin|crypto(?:currency)?|forex|gold\s+price|mutual\s+fund\s+nav|us\s+stocks?|nasdaq|tesla|apple\s+stock)\b/i;
const FINANCE_HINT = /\b(?:revenue|profit|margin|roce|roe|roa|debt|equity|cash|ratio|p\/?e|valuation|growth|quarter|fy\d|results?|sector|market|index|breadth|briefing|announcement|filing|shareholding|promoter|pledge|backtest|strategy|drawdown|sharpe|metric|define|what\s+is|explain|how\s+(?:did|has|is)|compare|peers?|ebitda|eps|dividend|volatility|rsi|moving\s+average|nim|npa|capital\s+adequacy|stock|share|company)\b/i;

export function classify(question: string): PolicyResult {
  const q = question.normalize('NFKC');
  const reasons: string[] = [];
  if (INJECTION.some((r) => r.test(q))) reasons.push('instruction-override pattern');
  const advice = ADVICE.filter((r) => r.test(q));
  if (advice.length) return { intent: 'advice', reasons: [...reasons, 'advice-seeking pattern'] };
  if (reasons.length) return { intent: 'injection', reasons };
  if (ABUSIVE.test(q)) return { intent: 'abusive', reasons: ['abusive language'] };
  if (OFF_TOPIC.test(q) && !FINANCE_HINT.test(q)) return { intent: 'off_topic', reasons: ['outside Indian listed equities research'] };
  return { intent: 'research', reasons: [] };
}

export const POLICY_RESPONSES = {
  advice: 'ATLAS does not give recommendations, buy/sell/hold views, price targets, allocations or predictions. It can show what the data says — results and margin trends, peer context, ownership changes and quality checks that require review — with every figure linked to its source.',
  injection: 'ATLAS follows its research rules whatever a message or document says. It can answer questions about covered companies, the market briefing, metric definitions and your backtests.',
  abusive: 'ATLAS can help with research questions about covered Indian listed companies, the market briefing and metric definitions.',
  off_topic: 'That is outside what ATLAS covers. ATLAS answers questions about Indian listed companies in its coverage, the daily market briefing, metric definitions and your historical tests.',
};
