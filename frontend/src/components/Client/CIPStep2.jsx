import React, { useState, useEffect } from 'react';
import { useClient } from '../../context/ClientContext';

// ── Questions (exact from wireframe) ──────────────────────────────────────────

const WILLINGNESS_QUESTIONS = [
  {
    id: 'lossTolerance',
    prompt: 'If your portfolio fell 20% in a market downturn, what would you do?',
    options: [
      { value: 'sellAll',  label: 'Sell everything to stop further loss',     points: 5  },
      { value: 'sellSome', label: 'Sell some to reduce exposure',              points: 30 },
      { value: 'holdWait', label: 'Hold and wait it out',                      points: 65 },
      { value: 'buyMore',  label: 'See it as a buying opportunity',            points: 95 },
    ],
  },
  {
    id: 'marketReaction',
    prompt: 'How closely do you follow your portfolio\u2019s day-to-day movements?',
    options: [
      { value: 'daily',   label: 'Daily \u2014 and it affects my mood',          points: 15 },
      { value: 'weekly',  label: 'Weekly, with some concern on down days',      points: 40 },
      { value: 'monthly', label: 'Monthly or less, generally unbothered',       points: 70 },
      { value: 'rarely',  label: 'Rarely \u2014 I trust the long-term plan',    points: 95 },
    ],
  },
  {
    id: 'returnExpectation',
    prompt: 'Which statement best matches your return expectations?',
    options: [
      { value: 'stability', label: 'Stability matters more than returns',                points: 10 },
      { value: 'modest',    label: 'Modest, steady growth above inflation',              points: 40 },
      { value: 'strong',    label: 'Strong long-term growth, accepting volatility',      points: 75 },
      { value: 'maximum',   label: 'Maximum growth, volatility doesn\u2019t concern me', points: 95 },
    ],
  },
  {
    id: 'investmentBehaviour',
    prompt: 'How would you describe your past investment decisions?',
    options: [
      { value: 'avoided',    label: 'I\u2019ve mostly avoided market-linked investments',    points: 10 },
      { value: 'cautious',   label: 'Cautious \u2014 mostly debt/hybrid products',          points: 35 },
      { value: 'mixed',      label: 'A mix of equity and debt, adjusted over time',         points: 65 },
      { value: 'aggressive', label: 'Mostly equity, including direct stocks/thematic bets', points: 90 },
    ],
  },
  {
    id: 'experience',
    prompt: 'How much experience do you have with market-linked investments?',
    options: [
      { value: 'none',      label: 'First-time investor',      points: 15 },
      { value: 'some',      label: '1\u20133 years',           points: 40 },
      { value: 'moderate',  label: '3\u20137 years',           points: 65 },
      { value: 'extensive', label: '7+ years / professional',  points: 90 },
    ],
  },
];

const CAPACITY_QUESTIONS = [
  {
    id: 'horizonYears',
    prompt: 'What is the investment horizon for this money?',
    options: [
      { value: 'short',    label: 'Under 3 years', points: 10 },
      { value: 'medium',   label: '3\u20135 years', points: 35 },
      { value: 'long',     label: '5\u20137 years', points: 65 },
      { value: 'veryLong', label: '7+ years',      points: 95 },
    ],
  },
  {
    id: 'liquidityNeed',
    prompt: 'How soon might the client need to access a meaningful portion of this money?',
    options: [
      { value: 'immediate', label: 'Within the next year',            points: 10 },
      { value: 'medium',    label: 'Within 1\u20133 years',           points: 40 },
      { value: 'low',       label: 'Unlikely within 3\u20135 years',  points: 70 },
      { value: 'none',      label: 'No foreseeable need',             points: 95 },
    ],
  },
  {
    id: 'incomeDependence',
    prompt: 'Does the client depend on this portfolio for regular income?',
    options: [
      { value: 'fully',     label: 'Yes, it\u2019s a primary income source',      points: 10 },
      { value: 'partially', label: 'Partially supplements other income',           points: 40 },
      { value: 'rarely',    label: 'Rarely, only in emergencies',                 points: 70 },
      { value: 'never',     label: 'No \u2014 fully funded by other sources',     points: 95 },
    ],
  },
  {
    id: 'financialCommitments',
    prompt: 'How would you describe the client\u2019s other financial commitments (loans, dependants, upcoming expenses)?',
    options: [
      { value: 'heavy',    label: 'Significant \u2014 limited financial slack',   points: 15 },
      { value: 'moderate', label: 'Moderate, manageable commitments',             points: 45 },
      { value: 'light',    label: 'Light commitments relative to means',          points: 75 },
      { value: 'none',     label: 'Minimal to no significant commitments',        points: 95 },
    ],
  },
  {
    id: 'goalFlexibility',
    prompt: 'How flexible is the underlying goal (can the amount, timing, or target change)?',
    options: [
      { value: 'fixed',    label: 'Fixed \u2014 little room to adjust',           points: 15 },
      { value: 'someFlex', label: 'Some flexibility in timing or amount',         points: 50 },
      { value: 'flexible', label: 'Fairly flexible on both',                      points: 80 },
    ],
  },
  {
    id: 'incomeRange',
    prompt: 'Annual income range',
    options: [
      { value: 'below10L',  label: 'Below \u20b910L',      points: 20 },
      { value: '10to25L',   label: '\u20b910\u201325L',    points: 40 },
      { value: '25to50L',   label: '\u20b925\u201350L',    points: 60 },
      { value: '50Lto1Cr',  label: '\u20b950L\u20131Cr',   points: 80 },
      { value: 'above1Cr',  label: 'Above \u20b91Cr',      points: 95 },
    ],
  },
  {
    id: 'netWorthRange',
    prompt: 'Net worth / investible assets (excluding primary residence)',
    options: [
      { value: 'below50L',  label: 'Below \u20b950L',      points: 15 },
      { value: '50Lto2Cr',  label: '\u20b950L\u20132Cr',   points: 40 },
      { value: '2to5Cr',    label: '\u20b92\u20135Cr',     points: 60 },
      { value: '5to15Cr',   label: '\u20b95\u201315Cr',    points: 80 },
      { value: 'above15Cr', label: 'Above \u20b915Cr',     points: 95 },
    ],
  },
  {
    id: 'investmentPctOfNetWorth',
    prompt: 'What percentage of the client\u2019s investible assets does this investment amount represent?',
    options: [
      { value: 'under10', label: 'Under 10%',   points: 95 },
      { value: '10to25',  label: '10\u201325%', points: 65 },
      { value: '25to50',  label: '25\u201350%', points: 35 },
      { value: 'over50',  label: '50% or more', points: 10 },
    ],
  },
];

// ── Scoring logic (exact from wireframe) ─────────────────────────────────────

function scoreToRiskKey(score) {
  if (score == null) return null;
  if (score < 20) return 'conservative';
  if (score < 40) return 'mod_conservative';
  if (score < 60) return 'balanced';
  if (score < 80) return 'mod_aggressive';
  return 'aggressive';
}

function scoreDimension(questions, answers) {
  let sum = 0, count = 0;
  questions.forEach(q => {
    const ans = answers[q.id];
    if (!ans) return;
    const opt = q.options.find(o => o.value === ans);
    if (!opt) return;
    sum += opt.points;
    count++;
  });
  return count > 0
    ? { score: Math.round(sum / count), answeredCount: count, totalCount: questions.length }
    : null;
}

function deriveProfile(willingnessAnswers, capacityAnswers) {
  const w = scoreDimension(WILLINGNESS_QUESTIONS, willingnessAnswers || {});
  const c = scoreDimension(CAPACITY_QUESTIONS, capacityAnswers || {});
  const wFull = w && w.answeredCount === w.totalCount;
  const cFull = c && c.answeredCount === c.totalCount;

  if (!wFull || !cFull) {
    return {
      willingnessScore: w ? w.score : null,
      capacityScore:    c ? c.score : null,
      overallScore: null, riskKey: null, complete: false,
      willingnessAnswered: w ? w.answeredCount : 0,
      willingnessTotal: WILLINGNESS_QUESTIONS.length,
      capacityAnswered: c ? c.answeredCount : 0,
      capacityTotal: CAPACITY_QUESTIONS.length,
    };
  }

  const overall = Math.min(w.score, c.score);
  // On a tie, capacity is binding (more conservative read)
  const constrainedBy = w.score === c.score ? 'capacity'
    : (w.score < c.score ? 'willingness' : 'capacity');

  return {
    willingnessScore: w.score, capacityScore: c.score,
    overallScore: overall, riskKey: scoreToRiskKey(overall),
    constrainedBy, complete: true,
  };
}

const RISK_META = {
  conservative:     { label: 'Conservative',          color: '#1A7A52', eq: '0–28%'   },
  mod_conservative: { label: 'Moderately Conservative', color: '#2563EB', eq: '28–48%' },
  balanced:         { label: 'Balanced',               color: '#D97706', eq: '48–70%'  },
  mod_aggressive:   { label: 'Moderately Aggressive',  color: '#EA580C', eq: '70–90%'  },
  aggressive:       { label: 'Aggressive',             color: '#912F63', eq: '80–100%' },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressBar({ label, done, total, color }) {
  const pct = total ? Math.round(done / total * 100) : 0;
  return (
    <div className="cip-progress-item">
      <div className="cip-progress-label">
        <span>{label}</span>
        <span>{done}/{total}</span>
      </div>
      <div className="cip-progress-track">
        <div className="cip-progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function ScoreCard({ profile }) {
  if (!profile.complete) return null;
  const meta = RISK_META[profile.riskKey];
  if (!meta) return null;

  return (
    <div className="cip-score-card">
      <div className="cip-score-card-header">
        <div>
          <div className="cip-score-card-label">Derived Risk Profile</div>
          <div className="cip-score-card-profile" style={{ color: meta.color }}>
            {meta.label}
          </div>
          <div className="cip-score-card-eq">{meta.eq} equity</div>
        </div>
        <div className="cip-score-card-scores">
          <div className="cip-score-dim">
            <div className="cip-score-dim-val" style={{ color: '#3E3452' }}>{profile.willingnessScore}</div>
            <div className="cip-score-dim-label">Willingness</div>
          </div>
          <div className="cip-score-sep">×</div>
          <div className="cip-score-dim">
            <div className="cip-score-dim-val" style={{ color: '#912F63' }}>{profile.capacityScore}</div>
            <div className="cip-score-dim-label">Capacity</div>
          </div>
          <div className="cip-score-sep">=</div>
          <div className="cip-score-dim">
            <div className="cip-score-dim-val" style={{ color: meta.color }}>{profile.overallScore}</div>
            <div className="cip-score-dim-label">Overall</div>
          </div>
        </div>
      </div>
      <div className="cip-score-binding">
        Constrained by: <strong>Risk {profile.constrainedBy === 'capacity' ? 'Capacity' : 'Willingness'}</strong>
        {profile.constrainedBy === 'capacity'
          ? ' — financial capacity is the binding constraint, even if willingness is higher'
          : ' — risk appetite is the binding constraint'}
      </div>
    </div>
  );
}

function QuestionBlock({ q, answer, onSelect, index, total }) {
  const isAnswered = !!answer;
  return (
    <div className={`cip-question ${isAnswered ? 'answered' : ''}`}>
      <div className="cip-question-header">
        <span className="cip-question-num">{isAnswered ? '✓' : index + 1}</span>
        <span className="cip-question-prompt">{q.prompt}</span>
      </div>
      <div className="cip-question-options">
        {q.options.map(o => (
          <button
            key={o.value}
            className={`cip-option ${answer === o.value ? 'selected' : ''}`}
            onClick={() => onSelect(q.id, o.value)}
          >
            <span className="cip-option-radio" />
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main Step 2 component ─────────────────────────────────────────────────────

export default function CIPStep2({ profileMode, onNext, onBack }) {
  const { activeClient, updateClient } = useClient();
  const [saving, setSaving] = useState(false);

  const [willingnessAnswers, setWillingnessAnswers] = useState({});
  const [capacityAnswers, setCapacityAnswers] = useState({});

  // Load existing answers if editing
  useEffect(() => {
    if (activeClient) {
      if (activeClient.willingness_answers && Object.keys(activeClient.willingness_answers).length > 0) {
        setWillingnessAnswers(activeClient.willingness_answers);
      }
      if (activeClient.capacity_answers && Object.keys(activeClient.capacity_answers).length > 0) {
        setCapacityAnswers(activeClient.capacity_answers);
      }
    }
  }, [activeClient]);

  const profile = deriveProfile(willingnessAnswers, capacityAnswers);

  const setWillingness = (id, value) => setWillingnessAnswers(prev => ({ ...prev, [id]: value }));
  const setCapacity    = (id, value) => setCapacityAnswers(prev => ({ ...prev, [id]: value }));

  // Existing profile mode — show pre-filled read-only
  if (profileMode === 'existing') {
    const meta = activeClient?.risk_profile ? RISK_META[activeClient.risk_profile] : null;
    return (
      <div className="cip-step-panel">
        <div className="cip-step-title">Risk Assessment</div>
        <div className="cip-step-desc">
          Using the existing approved risk profile captured in Step 1 — no questionnaire needed.
        </div>
        {meta && (
          <div className="cip-score-card">
            <div className="cip-score-card-header">
              <div>
                <div className="cip-score-card-label">Approved Risk Profile</div>
                <div className="cip-score-card-profile" style={{ color: meta.color }}>
                  {meta.label}
                </div>
                <div className="cip-score-card-eq">{meta.eq} equity</div>
              </div>
            </div>
          </div>
        )}
        <div className="cip-nav-buttons">
          <button className="btn-outline" onClick={onBack}>← Back</button>
          <button className="btn-primary" onClick={onNext}>Continue →</button>
        </div>
      </div>
    );
  }

  const handleSaveAndContinue = async () => {
    if (!profile.complete) return;
    setSaving(true);
    try {
      if (activeClient) {
        await updateClient(activeClient.id, {
          willingness_answers: willingnessAnswers,
          capacity_answers:    capacityAnswers,
          willingness_score:   profile.willingnessScore,
          capacity_score:      profile.capacityScore,
          overall_score:       profile.overallScore,
          constrained_by:      profile.constrainedBy,
          risk_profile:        profile.riskKey,
          suitability_status:  'assessed',
        });
      }
      onNext();
    } catch (e) {
      console.error('Save failed', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cip-step-panel">
      <div className="cip-step-title">Risk Assessment</div>
      <div className="cip-step-desc">
        Two dimensions, scored separately — the lower of the two constrains the overall profile,
        so high willingness never overrides weak financial capacity.
        {profileMode === 'indicative' && (
          <span className="cip-indicative-inline"> Indicative mode: you can continue with a partial assessment.</span>
        )}
      </div>

      {/* Progress bars */}
      <div className="cip-progress-strip">
        <ProgressBar
          label="Risk willingness"
          done={profile.willingnessAnswered ?? Object.keys(willingnessAnswers).length}
          total={WILLINGNESS_QUESTIONS.length}
          color="#3E3452"
        />
        <ProgressBar
          label="Risk capacity"
          done={profile.capacityAnswered ?? Object.keys(capacityAnswers).length}
          total={CAPACITY_QUESTIONS.length}
          color="#912F63"
        />
      </div>

      {/* Score card — only shown when both complete */}
      <ScoreCard profile={profile} />

      {/* Willingness questions */}
      <div className="cip-section-hd">
        <span className="cip-section-num">W</span>
        RISK WILLINGNESS
      </div>
      <div className="cip-questions-list">
        {WILLINGNESS_QUESTIONS.map((q, i) => (
          <QuestionBlock
            key={q.id}
            q={q}
            answer={willingnessAnswers[q.id]}
            onSelect={setWillingness}
            index={i}
            total={WILLINGNESS_QUESTIONS.length}
          />
        ))}
      </div>

      {/* Capacity questions */}
      <div className="cip-section-hd" style={{ marginTop: 28 }}>
        <span className="cip-section-num" style={{ background: '#912F63' }}>C</span>
        RISK CAPACITY
      </div>
      <div className="cip-questions-list">
        {CAPACITY_QUESTIONS.map((q, i) => (
          <QuestionBlock
            key={q.id}
            q={q}
            answer={capacityAnswers[q.id]}
            onSelect={setCapacity}
            index={i}
            total={CAPACITY_QUESTIONS.length}
          />
        ))}
      </div>

      {/* Nav buttons */}
      <div className="cip-nav-buttons">
        <button className="btn-outline" onClick={onBack}>← Back</button>
        <button
          className="btn-primary"
          onClick={profileMode === 'indicative' ? onNext : handleSaveAndContinue}
          disabled={saving || (profileMode !== 'indicative' && !profile.complete)}
          title={!profile.complete && profileMode !== 'indicative' ? 'Answer all questions to continue' : ''}
        >
          {saving ? 'Saving…'
            : !profile.complete && profileMode !== 'indicative' ? `Answer all questions (${(profile.willingnessAnswered ?? 0) + (profile.capacityAnswered ?? 0)}/${WILLINGNESS_QUESTIONS.length + CAPACITY_QUESTIONS.length})`
            : 'Save & Continue →'}
        </button>
      </div>
    </div>
  );
}