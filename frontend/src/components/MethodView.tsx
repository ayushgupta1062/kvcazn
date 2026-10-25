import type { DecisionResponse, MetaResponse } from '../types'
import { whole } from '../format'
import { GateStrip } from './GateStrip'

interface Props {
  meta: MetaResponse
  decision?: DecisionResponse
  cutoff: string
}

const MEASURES = [
  {
    name: 'Typical miss (MAE)',
    plain: 'On an ordinary hour, how far the forecast was from what happened, ignoring direction.',
    how: 'Average of |forecast − actual|.',
    example: 'Misses of 10, 10 and 30 MW average 16.7 MW.',
  },
  {
    name: 'Big misses count extra (RMSE)',
    plain: 'Like the typical miss, but one large error weighs more than several small ones.',
    how: 'Square root of the average of (forecast − actual)².',
    example: '√((100 + 100 + 900) ÷ 3) = 19.1 MW.',
  },
  {
    name: 'Lean (bias)',
    plain: 'Whether forecasts run high or low overall. Positive means too much wind was expected.',
    how: 'Average of forecast − actual.',
    example: '+10, −10 and +30 MW average +10 MW, so the lean is high.',
  },
  {
    name: 'Miss as share of wind',
    plain: 'The typical miss as a percentage of the wind that actually blew.',
    how: 'Sum of |forecast − actual| ÷ sum of actual.',
    example: '50 MW ÷ 300 MW = 16.7%.',
  },
  {
    name: 'Reserve to cover 9 in 10 hours',
    plain: 'Extra power to hold above the forecast, so that in 9 of 10 past hours the wind shortfall would have been covered.',
    how: '90th percentile of forecast − actual, never below zero.',
    example: 'If 9 in 10 hours fell short by less than 300 MW, hold 300 MW.',
  },
]

export function MethodView({ meta, decision, cutoff }: Props) {
  const fetched = meta.fetchedAtUtc
    ? new Date(meta.fetchedAtUtc).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' })
    : null
  return (
    <>
      <section className="hero hero-compact" aria-labelledby="method-title">
        <div className="hero-main">
          <h2 id="method-title" className="hero-label">
            How to read this portal
          </h2>
          <p className="hero-note">What the numbers mean, where they come from, and what they leave out.</p>
        </div>
      </section>

      <section className="section ledger">
        <h3>The decision this supports</h3>
        <div className="prose">
          <p>
            Before the day-ahead auction closes, the desk has to buy tomorrow's power. Wind generation is free once the turbines turn, so
            the more wind is expected, the less has to be bought from gas and other plants. The catch is that nobody knows tomorrow's wind
            for sure, and the buying decision can't wait.
          </p>
          <p className="example">
            <strong>Everyday version:</strong> it's like ordering catering for tomorrow's party from a weather forecast. Order for sunshine
            and it rains, and you're short. Order for rain and it's sunny, and you've paid for food nobody eats.
          </p>
          <p>
            The portal answers two questions: which wind forecast could you actually use when the gate closed, and how far off are those
            forecasts usually?
          </p>
        </div>
      </section>

      <section className="section ledger">
        <h3>Which forecast counts</h3>
        <div className="prose">
          <p>
            Elexon issues a fresh wind forecast about eight times a day. When the gate closes, only the versions already issued can be
            used. For each hour of tomorrow, the portal takes the newest version issued at or before the gate. Later versions appear
            dashed in the revisions chart because the desk could not have had them.
          </p>
          {decision && (
            <GateStrip
              decisionDate={decision.decisionDate}
              publishTimes={decision.publishTimesOnDecisionDay}
              fallbackPublish={decision.latestPublishTime}
              cutoff={cutoff}
            />
          )}
          <p className="technical">
            <strong>Technical:</strong> for delivery hour T and gate time G on the day before (UK local time), pick the WINDFOR row with
            startTime = T and the largest publishTime ≤ G. If the newest version has no row for T, use the next newest that does.
          </p>
        </div>
      </section>

      <section className="section ledger">
        <h3>How accuracy is measured</h3>
        <div className="prose wide">
          <p>
            Every forecast the portal would have used is compared with what the wind actually did. A <em>miss</em> is forecast minus
            actual, so a positive miss means wind fell short of the forecast and you bought too little. Examples use forecasts of 110, 90
            and 130 MW against 100 MW each hour.
          </p>
          <div className="table-wrap static" tabIndex={0} role="region" aria-label="Measures explained">
            <table className="data def" role="table">
              <thead>
                <tr role="row">
                  <th scope="col" role="columnheader" className="first">Measure</th>
                  <th scope="col" role="columnheader">In plain words</th>
                  <th scope="col" role="columnheader">How it is worked out</th>
                  <th scope="col" role="columnheader">Example</th>
                </tr>
              </thead>
              <tbody>
                {MEASURES.map((m) => (
                  <tr key={m.name} role="row">
                    <th scope="row" role="rowheader" className="first">{m.name}</th>
                    <td role="cell" data-label="In plain words">{m.plain}</td>
                    <td role="cell" data-label="How it is worked out">{m.how}</td>
                    <td role="cell" data-label="Example">{m.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section ledger">
        <h3>Data and assumptions</h3>
        <div className="prose">
          <ul className="facts">
            <li>
              <strong>Actual wind.</strong> Elexon FUELHH, fuel type WIND, every half-hour, in MW. National, transmission-connected wind
              only.
            </li>
            <li>
              <strong>Forecast.</strong> Elexon WINDFOR, one value per hour, each version stamped with the time it was issued.
            </li>
            <li>
              <strong>Scope.</strong> Decisions made 1–31 January 2026 for delivery the next day, so delivery days run 2 January to 1
              February. All times are UK local time.
            </li>
            <li>
              <strong>Gate time.</strong> Starts at 09:50, when the N2EX day-ahead auction closes. The EPEX GB hourly auction closes at
              09:20. Confirm the desk's own gate and set it above.
            </li>
            <li>
              <strong>When a forecast counts as available.</strong> From the time Elexon says it was created. Any delay before it reaches
              the desk's screen is not modelled; to allow for one, set the gate earlier.
            </li>
            <li>
              <strong>Hourly against half-hourly.</strong> "Same timestamp" compares each forecast hour with the half-hour that starts at
              that time and invents nothing. "Hourly average" compares it with the mean of the two half-hours in that hour.
            </li>
            <li>
              <strong>Range on the forecast chart.</strong> The 10th to 90th percentile of past misses at the same gate, taken from the
              other days (the day shown is left out). It describes January, not a guarantee.
            </li>
            <li>
              <strong>Not included.</strong> Demand, solar, small embedded wind and prices. This pilot covers wind only.
            </li>
            <li>
              <strong>Data snapshot.</strong>{' '}
              {meta.dataSource === 'elexon' ? `Fetched ${fetched} from Elexon.` : 'Synthetic demo data, not from Elexon.'}{' '}
              {whole(meta.forecastRows)} forecast rows in {whole(meta.forecastVersions)} versions and {whole(meta.actualRows)} half-hourly
              actuals.
            </li>
          </ul>
        </div>
      </section>
    </>
  )
}
