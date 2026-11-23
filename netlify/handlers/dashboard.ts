import { route } from "../lib/router";
import { q, one } from "../lib/db";
import { json, readJson } from "../lib/http";
import { can } from "../lib/auth";
import { TX_FROM, Where, applyBatchFilters, parseFilters, txWhere } from "../lib/filters";
import { BATCH_FROM } from "./recon";

route("POST", "/dashboard", { perm: "dashboard.view" }, async ({ req, user }) => {
  const body = await readJson(req);
  const f = parseFilters(body.filters);
  const period = ["day", "week", "month"].includes(body.period) ? body.period : "month";
  const showExc = can(user, "exceptions.view");

  const bw = () => {
    const w = new Where();
    applyBatchFilters(w, f, user);
    return w;
  };

  const run = async () => {
    const w1 = bw();
    const totals = one(
      `SELECT count(*)::int AS submissions, COALESCE(sum(b.transaction_count), 0)::int AS transactions FROM reconciliation_batches b ${w1.sql}`,
      w1.params,
    );
    const w2 = bw();
    const byPeriod = q(
      `SELECT date_trunc(${w2.push(period)}::text, b.recon_date::timestamp)::date::text AS period, count(*)::int AS submissions, sum(b.transaction_count)::int AS transactions
         FROM reconciliation_batches b ${w2.sql} GROUP BY 1 ORDER BY 1 DESC LIMIT 24`,
      w2.params,
    );
    const w3 = bw();
    const byStatus = q(
      `SELECT rs.name AS label, count(*)::int AS value FROM reconciliation_batches b JOIN recon_statuses rs ON rs.id = b.status_id ${w3.sql} GROUP BY rs.name, rs.sort_order ORDER BY rs.sort_order`,
      w3.params,
    );
    const w4 = bw();
    const byOfficer = q(
      `SELECT up.full_name AS label, count(*)::int AS value, sum(b.transaction_count)::int AS transactions ${BATCH_FROM} ${w4.sql} GROUP BY up.full_name ORDER BY value DESC LIMIT 15`,
      w4.params,
    );
    const w5 = txWhere(f, user);
    const tags = one(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE t.tag = 'P2S')::int AS p2s, count(*) FILTER (WHERE t.tag = 'P2F')::int AS p2f,
              count(*) FILTER (WHERE t.tag = 'F2S')::int AS f2s, count(*) FILTER (WHERE t.tag = 'S2F')::int AS s2f ${TX_FROM} ${w5.sql}`,
      w5.params,
    );
    const w6 = txWhere(f, user);
    const byTerminator = q(
      `SELECT tm.name AS label, count(*)::int AS transactions, count(e.id)::int AS exceptions,
              CASE WHEN count(*) = 0 THEN 0 ELSE round(100.0 * count(e.id) / count(*), 2) END::float8 AS rate
         ${TX_FROM} ${w6.sql} GROUP BY tm.name ORDER BY rate DESC, tm.name`,
      w6.params,
    );
    const w9 = txWhere(f, user);
    const recurring = q(
      `SELECT min(t.trans_id) AS "transId", count(*)::int AS occurrences, count(DISTINCT b.id)::int AS batches,
              count(e.id)::int AS "exceptionOccurrences", string_agg(DISTINCT t.tag, ', ') AS tags
         ${TX_FROM} ${w9.sql} GROUP BY lower(t.trans_id) HAVING count(DISTINCT b.id) > 1
        ORDER BY count(DISTINCT b.id) DESC, count(*) DESC LIMIT 15`,
      w9.params,
    );
    let exceptionByStatus: Promise<any> | null = null, aging: Promise<any> | null = null, byFollowUp: Promise<any> | null = null;
    if (showExc) {
      const w7 = txWhere({ ...f, onlyExceptions: true }, user);
      exceptionByStatus = q(`SELECT e.status AS label, count(*)::int AS value ${TX_FROM} ${w7.sql} GROUP BY e.status`, w7.params);
      const w8 = txWhere({ ...f, outstandingOnly: true }, user);
      aging = q(
        `SELECT CASE WHEN age <= 7 THEN '0-7 days' WHEN age <= 14 THEN '8-14 days' WHEN age <= 30 THEN '15-30 days' WHEN age <= 60 THEN '31-60 days' ELSE '60+ days' END AS label,
                count(*)::int AS value, min(age)::int AS "minAge"
           FROM (SELECT (current_date - e.created_at::date) AS age ${TX_FROM} ${w8.sql}) x GROUP BY 1 ORDER BY min(age)`,
        w8.params,
      );
      const w10 = txWhere({ ...f, outstandingOnly: true }, user);
      byFollowUp = q(
        `SELECT COALESCE(e.follow_up_name, 'Unassigned') AS label, count(*)::int AS value ${TX_FROM} ${w10.sql} GROUP BY 1 ORDER BY value DESC LIMIT 15`,
        w10.params,
      );
    }
    const [t, bp, bs, bo, tg, bt, rec, es, ag, bf] = await Promise.all([totals, byPeriod, byStatus, byOfficer, tags, byTerminator, recurring, exceptionByStatus, aging, byFollowUp]);
    return { totals: t, byPeriod: bp.reverse(), byStatus: bs, byOfficer: bo, tags: tg, byTerminator: bt, recurring: rec, exceptionByStatus: es, aging: ag, byFollowUp: bf };
  };
  return json({ period, ...(await run()) });
});
