// Provider assessments: what each candidate real-data source allows, checked against its published
// terms. Version-controlled so every change is reviewed. A source whose terms prohibit automated
// retrieval is never fetched by ATLAS; connecting real data needs a licence or written consent.
// Assessments are not legal advice; they record what the published terms say and when they were read.

export type RightStatus = 'permitted' | 'prohibited' | 'requires_consent' | 'requires_licence' | 'unverified';

export interface ProviderAssessment {
  provider_id: string;
  provider: string;
  datasets: string[];
  site: string;
  terms_url: string;
  assessed_on: string;
  automated_retrieval: RightStatus;
  local_retention: RightStatus;
  commercial_display: RightStatus;
  redistribution: RightStatus;
  finding: string;
  atlas_action: string;
  next_step: string;
}

export const PROVIDER_ASSESSMENT_VERSION = 'providers-2026-10-20';

export const PROVIDER_ASSESSMENTS: ProviderAssessment[] = [
  {
    provider_id: 'nse-website',
    provider: 'National Stock Exchange of India — public website (nseindia.com, nsearchives.nseindia.com)',
    datasets: ['EOD price reports (bhavcopy)', 'corporate announcements', 'financial results', 'index constituent files'],
    site: 'https://www.nseindia.com/all-reports',
    terms_url: 'https://www.nseindia.com/static/nse-terms-of-use',
    assessed_on: '2026-10-20',
    automated_retrieval: 'prohibited',
    local_retention: 'prohibited',
    commercial_display: 'requires_licence',
    redistribution: 'prohibited',
    finding: 'The terms of use prohibit systematic or automated data collection (scraping, data mining, extraction, harvesting) and the copying or electronic storage of website content.',
    atlas_action: 'Not fetched. No scheduled job, scraper or downloader targets this site.',
    next_step: 'License end-of-day and corporate data from NSE Data & Analytics or an NSE-authorised vendor, then add a provider adapter for that feed.',
  },
  {
    provider_id: 'nse-indices-website',
    provider: 'NSE Indices Limited — public website (niftyindices.com)',
    datasets: ['Nifty 50 constituent list', 'index factsheets'],
    site: 'https://www.niftyindices.com/indices/equity/broad-based-indices/nifty--50',
    terms_url: 'https://www.niftyindices.com/terms-of-use',
    assessed_on: '2026-10-20',
    automated_retrieval: 'requires_consent',
    local_retention: 'unverified',
    commercial_display: 'prohibited',
    redistribution: 'unverified',
    finding: 'The terms prohibit systematic or automated data collection without express written consent, and limit site use to personal, non-commercial purposes.',
    atlas_action: 'Not fetched. The official Nifty 50 constituent list is not imported automatically.',
    next_step: 'Obtain written consent or an index data licence from NSE Indices Limited for constituent data.',
  },
  {
    provider_id: 'bse-website',
    provider: 'BSE Limited — public website (bseindia.com)',
    datasets: ['company filings (cross-check)'],
    site: 'https://www.bseindia.com',
    terms_url: 'https://www.bseindia.com/termsofuse.html',
    assessed_on: '2026-10-20',
    automated_retrieval: 'unverified',
    local_retention: 'unverified',
    commercial_display: 'unverified',
    redistribution: 'unverified',
    finding: 'The terms page did not render its text in the browser used for the assessment, so its rules could not be read.',
    atlas_action: 'Not fetched. Rights are treated as unknown, which means not permitted.',
    next_step: 'Read the BSE terms (or ask BSE) before any use; prefer a licensed vendor feed.',
  },
  {
    provider_id: 'user-supplied',
    provider: 'Files you upload (My research → Your own data)',
    datasets: ['price series you are entitled to use'],
    site: '/app/research/datasets',
    terms_url: '/legal/terms',
    assessed_on: '2026-10-20',
    automated_retrieval: 'permitted',
    local_retention: 'permitted',
    commercial_display: 'prohibited',
    redistribution: 'prohibited',
    finding: 'You confirm at upload that you may use the file. ATLAS keeps it private to your account, validates it, records provenance and never shares or redistributes it.',
    atlas_action: 'Available now: CSV upload with column mapping, validation, provenance and per-user isolation.',
    next_step: '—',
  },
];
