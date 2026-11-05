/**
 * Usage today, at the top of Settings (2026-11-05), as Google Stitch's
 * settings page opens with its daily credits. Forma has no credits of its own:
 * each Gemini model's free tier allows so many requests a day, and Forma
 * counts what this browser sent to each (`lib/requestCount.ts`). A bar is
 * drawn only against a limit Google has stated, which it does in the 429 that
 * ends a model's day (`dailyLimitOf`); Forma does not guess one. Another tab
 * or device on the same key is not counted, so the words are "sent from this
 * browser", never "left".
 */
import { dailyLimits, requestsToday } from '../lib/requestCount';
import { msUntilPacificMidnight } from '../lib/geminiErrors';
import { displayModel } from '../lib/modelTiers';
import './overlays.css';

export default function UsageSettings({ now = new Date() }: { now?: Date }) {
  const used = requestsToday(undefined, now);
  const limits = dailyLimits();
  const models = Object.keys(used).sort((a, b) => used[b] - used[a] || a.localeCompare(b));
  const reset = msUntilPacificMidnight(now);
  const hours = Math.floor(reset / 3_600_000);
  const minutes = Math.floor((reset % 3_600_000) / 60_000);
  return (
    <div className="wb-fset">
      <div className="wb-eyebrow">
        <b>day</b>Usage today<span className="wb-fade" />
      </div>
      {models.length === 0 ? (
        <p className="wb-hint">No requests from this browser today.</p>
      ) : (
        <ul className="wb-usage" aria-label="Requests sent today, by model">
          {models.map((id) => {
            const limit = limits[id];
            const share = limit ? Math.min(100, (used[id] / limit) * 100) : null;
            return (
              <li key={id}>
                <span>{displayModel(id)}</span>
                <span className="wb-usage-count">{limit ? `${used[id]} of ${limit}` : `${used[id]} today`}</span>
                {share !== null && (
                  <span className="wb-usage-bar" role="img" aria-label={`${Math.round(share)}% of the day's limit`}>
                    <i style={{ width: `${share}%` }} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="wb-hint">
        Sent from this browser. Google's free limits are per model per day and start again at midnight Pacific time, in {hours} h {minutes} min. A
        model's limit shows once Google has stated it.
      </p>
    </div>
  );
}
