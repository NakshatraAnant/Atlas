-- Content fingerprint of every calculated table, excluding run ids and timestamps, so two
-- pipeline runs can be compared exactly (used by the batching regression test and scripts).
SELECT
  (SELECT count(*)::int FROM market.adjusted_price_cache) AS adjusted_rows,
  (SELECT md5(string_agg(concat_ws('|', security_id, trade_date, cum_factor, adj_close, adj_volume, tr_close), E'\n' ORDER BY security_id, trade_date)) FROM market.adjusted_price_cache) AS adjusted_md5,
  (SELECT count(*)::int FROM calc.security_daily) AS daily_rows,
  (SELECT md5(string_agg(concat_ws('|', security_id, trade_date, adj_close, ret_1d, sma_20, sma_50, sma_200, rsi_14, vol_20d, adv_20d, high_52w, low_52w, market_cap_cr, shares_outstanding, pe_ttm, pb, ev_ebitda, dividend_yield, fundamentals_as_of), E'\n' ORDER BY security_id, trade_date)) FROM calc.security_daily) AS daily_md5,
  (SELECT count(*)::int FROM calc.metric_values) AS metric_rows,
  -- Company metrics are keyed by ISIN (company ids are random per seed); inputs_hash embeds ids, so it is excluded.
  (SELECT md5(string_agg(concat_ws('|', m.entity_type, coalesce(s.isin, m.entity_id), m.metric_code, m.period_key, m.basis, m.definition_version, m.value, m.missing_reason, m.unit, m.as_of_date, m.period_end, m.available_at, m.quality_status), E'
' ORDER BY m.entity_type, coalesce(s.isin, m.entity_id), m.metric_code, m.period_key, m.basis, m.definition_version)) FROM calc.metric_values m LEFT JOIN ref.securities s ON m.entity_type = 'company' AND s.company_id::text = m.entity_id) AS metric_md5,
  (SELECT count(*)::int FROM calc.market_daily) AS market_rows,
  (SELECT md5(string_agg(concat_ws('|', universe_code, trade_date, traded, advances, declines, pct_above_50dma, pct_above_200dma, new_highs, new_lows, turnover_cr, realised_vol_20d, regime::text), E'\n' ORDER BY universe_code, trade_date)) FROM calc.market_daily) AS market_md5;
