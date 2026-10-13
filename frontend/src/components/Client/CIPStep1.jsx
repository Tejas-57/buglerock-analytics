import React, { useState, useEffect } from 'react';
import { useClient } from '../../context/ClientContext';

const RISK_TAXONOMY = [
  { value: 'conservative',     label: 'Conservative' },
  { value: 'mod_conservative', label: 'Moderately Conservative' },
  { value: 'balanced',         label: 'Balanced' },
  { value: 'mod_aggressive',   label: 'Moderately Aggressive' },
  { value: 'aggressive',       label: 'Aggressive' },
];

const TAX_STATUS_OPTIONS = [
  'Resident individual', 'HUF', 'NRI', 'Corporate / Trust', 'PMS / AIF',
];

const OBJECTIVE_OPTIONS = [
  'Wealth creation', 'Retirement planning', 'Child education',
  'Tax optimisation', 'Capital preservation', 'Regular income',
  'Corpus building', 'NRI repatriation corpus',
];

const HORIZON_OPTIONS = [
  { value: 'short',    label: 'Short-term (1–3 years)' },
  { value: 'medium',   label: 'Medium-term (3–5 years)' },
  { value: 'long',     label: 'Long-term (5–7 years)' },
  { value: 'veryLong', label: 'Very long-term (7+ years)' },
];

const LIQUIDITY_OPTIONS = [
  'None', 'Low (≤5% in 30 days)', 'Moderate (≤10% in 3 months)', 'High (≥20% within 1 month)',
];

const INCOME_OPTIONS = [
  { value: 'none',     label: 'None' },
  { value: 'periodic', label: 'Periodic' },
  { value: 'regular',  label: 'Regular' },
];

const SOURCE_OPTIONS = [
  'Salary / Business income', 'Inheritance / Gift', 'Asset sale proceeds',
  'Retirement corpus', 'Other',
];

const MODE_CARDS = [
  {
    mode: 'full',
    title: 'Complete Risk Assessment',
    blurb: 'Full willingness + capacity questionnaire. Produces an approved, downstream-authoritative risk profile.',
  },
  {
    mode: 'existing',
    title: 'Use Existing Approved Profile',
    blurb: 'Client already has an approved risk profile on file. Skip the questionnaire.',
  },
  {
    mode: 'indicative',
    title: 'Indicative Profile',
    blurb: 'Quick starting point for proposal preparation only — cannot be finalised as a suitable recommendation.',
  },
];

function SectionHeader({ num, title }) {
  return (
    <div className="cip-section-hd">
      <span className="cip-section-num">{num}</span>
      {title.toUpperCase()}
    </div>
  );
}

function Field({ label, children, span2 }) {
  return (
    <div className={`cip-field ${span2 ? 'cip-field-span2' : ''}`}>
      <label className="cip-field-label">{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input
      className="cip-input"
      type={type}
      value={value || ''}
      placeholder={placeholder || ''}
      onChange={e => onChange(e.target.value)}
    />
  );
}

function SelectInput({ value, onChange, options }) {
  return (
    <select className="cip-select" value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">— Select —</option>
      {options.map(o => (
        typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export default function CIPStep1({ profileMode, setProfileMode, onNext, isNewClient }) {
  const { activeClient, createClient, updateClient, clients } = useClient();
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  // Form state
  const [form, setForm] = useState({
    name: '',
    pan: '',
    investment_amount: '',
    rm_name: 'BugleRock Capital',
    email: '',
    tax_status: 'Resident individual',
    next_review_date: '',
    objective: 'Wealth creation',
    horizon: '',
    liquidity_need: 'None',
    income_requirement: 'none',
    sip: '',
    source_of_funds: '',
    existing_holdings: '',
    // For 'existing' mode
    existing_risk_profile: '',
    assessment_date: '',
    valid_until: '',
    assessment_basis: '',
  });

  // Load from active client if editing
  useEffect(() => {
    if (activeClient) {
      setForm(prev => ({
        ...prev,
        name:              activeClient.name || '',
        pan:               activeClient.pan || '',
        investment_amount: activeClient.investment_amount || '',
        rm_name:           activeClient.rm_name || 'BugleRock Capital',
        email:             activeClient.email || '',
        tax_status:        activeClient.tax_status || 'Resident individual',
        next_review_date:  activeClient.next_review_date || '',
        objective:         activeClient.objective || 'Wealth creation',
        horizon:           activeClient.horizon || '',
        liquidity_need:    activeClient.liquidity_need || 'None',
        income_requirement:activeClient.income_requirement || 'none',
        sip:               activeClient.sip || '',
        source_of_funds:   activeClient.source_of_funds || '',
        existing_risk_profile: activeClient.risk_profile || '',
        assessment_date:   activeClient.assessment_date || '',
        valid_until:       activeClient.valid_until || '',
        assessment_basis:  activeClient.assessment_basis || '',
      }));
    }
  }, [activeClient]);

  const set = (field) => (val) => setForm(prev => ({ ...prev, [field]: val }));

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Client name is required';
    if (!form.investment_amount) e.investment_amount = 'Investment amount is required';
    if (profileMode === 'existing' && !form.existing_risk_profile) {
      e.existing_risk_profile = 'Please select an approved risk profile';
    }
    if (profileMode === 'existing' && !form.assessment_date) {
      e.assessment_date = 'Assessment date is required';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // Check if valid_until is in the past
  const validUntilIsPast = form.valid_until &&
    !isNaN(new Date(form.valid_until).getTime()) &&
    new Date(form.valid_until) < new Date();

  const handleSaveAndContinue = async (force = false) => {
    if (!validate()) return;

    // Duplicate check — only for new clients
    if (!activeClient && !force) {
      const name = form.name.trim().toLowerCase();
      const duplicate = clients.find(c => c.name.trim().toLowerCase() === name);
      if (duplicate) {
        setDuplicateWarning(true);
        return;
      }
    }

    setDuplicateWarning(false);
    setSaving(true);
    try {
      // Determine suitability status
      let suitability_status = 'draft';
      if (profileMode === 'existing') {
        suitability_status = validUntilIsPast ? 'expired' : 'approved';
      } else if (profileMode === 'indicative') {
        suitability_status = 'indicative';
      }

      const payload = {
        name: form.name.trim(),
        pan: form.pan.trim() || null,
        email: form.email.trim() || null,
        rm_name: form.rm_name.trim() || null,
        tax_status: form.tax_status || null,
        investment_amount: form.investment_amount ? parseInt(String(form.investment_amount).replace(/,/g, ''), 10) || null : null,
        sip: form.sip ? parseInt(String(form.sip).replace(/,/g, ''), 10) || null : null,
        objective: form.objective || null,
        horizon: form.horizon || null,
        liquidity_need: form.liquidity_need || null,
        income_requirement: form.income_requirement || null,
        source_of_funds: form.source_of_funds || null,
        next_review_date: form.next_review_date || null,
        profile_mode: profileMode,
        suitability_status,
        // For existing mode — risk profile is already known
        risk_profile: profileMode === 'existing' ? form.existing_risk_profile : (activeClient?.risk_profile || null),
        assessment_date: profileMode === 'existing' ? form.assessment_date : null,
        valid_until: profileMode === 'existing' ? form.valid_until : null,
        assessment_basis: profileMode === 'existing' ? form.assessment_basis : null,
      };

      if (activeClient) {
        await updateClient(activeClient.id, payload);
      } else {
        await createClient(payload);
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
      <div className="cip-step-title">Client Investment Profile</div>
      <div className="cip-step-desc">
        Capture the minimum institutional-quality information needed to govern every recommendation
        downstream — Retirement Planner, Model Portfolios and Portfolio Builder all read this one profile.
      </div>

      {/* ── Mode selector — show when no mode chosen yet, or for new clients ── */}
      {(isNewClient || !profileMode) && (
        <div className="cip-mode-section">
          <div className="cip-mode-question">How would you like to create this profile?</div>
          <div className="cip-mode-cards">
            {MODE_CARDS.map(mc => (
              <div
                key={mc.mode}
                className={`cip-mode-card ${profileMode === mc.mode ? 'selected' : ''}`}
                onClick={() => setProfileMode(mc.mode)}
              >
                <div className="cip-mode-card-title">
                  {mc.title}
                  {profileMode === mc.mode && <span className="cip-mode-check">✓</span>}
                </div>
                <div className="cip-mode-card-blurb">{mc.blurb}</div>
              </div>
            ))}
          </div>
          {profileMode === 'indicative' && (
            <div className="cip-indicative-warn">
              Indicative profiles are for proposal preparation only — outputs will be marked
              "Indicative, formal risk assessment not completed" and cannot be finalised as a
              suitable recommendation.
            </div>
          )}
        </div>
      )}

      {/* ── Existing approved profile picker ── */}
      {profileMode === 'existing' && (
        <div className="cip-form-section">
          <SectionHeader num="A2" title="Existing approved risk profile" />
          <div className="cip-form-grid">
            <Field label="Approved Risk Profile">
              <SelectInput
                value={form.existing_risk_profile}
                onChange={set('existing_risk_profile')}
                options={RISK_TAXONOMY}
              />
              {errors.existing_risk_profile && <span className="cip-error">{errors.existing_risk_profile}</span>}
            </Field>
            <Field label="Assessment Date">
              <TextInput type="date" value={form.assessment_date} onChange={set('assessment_date')} />
              {errors.assessment_date && <span className="cip-error">{errors.assessment_date}</span>}
            </Field>
            <Field label="Valid Until">
              <TextInput type="date" value={form.valid_until} onChange={set('valid_until')} />
            </Field>
          </div>
          <Field label="Basis / Source of This Approval" span2>
            <TextInput
              value={form.assessment_basis}
              onChange={set('assessment_basis')}
              placeholder="e.g. IC-approved risk profiling, 2025 annual KYC review"
            />
          </Field>
          {validUntilIsPast && (
            <div className="cip-indicative-warn" style={{ marginTop: 10 }}>
              This profile's valid-until date has already passed. It will be saved as <strong>Expired</strong>,
              not Approved — a fresh assessment is recommended.
            </div>
          )}
        </div>
      )}

      {/* ── Section A: Client Information ── */}
      <div className="cip-form-section">
        <SectionHeader num="A" title="Client Information" />
        <div className="cip-form-grid">
          <Field label="Client Name / Entity">
            <TextInput value={form.name} onChange={set('name')} placeholder="e.g. Priya Sharma" />
            {errors.name && <span className="cip-error">{errors.name}</span>}
          </Field>
          <Field label="PAN / Reference ID">
            <TextInput value={form.pan} onChange={set('pan')} placeholder="Optional" />
          </Field>
          <Field label="Investment Amount (₹)">
            <TextInput value={form.investment_amount} onChange={set('investment_amount')} placeholder="e.g. 50,00,000" />
            {errors.investment_amount && <span className="cip-error">{errors.investment_amount}</span>}
          </Field>
          <Field label="Prepared By (RM)">
            <TextInput value={form.rm_name} onChange={set('rm_name')} placeholder="BugleRock Capital" />
          </Field>
          <Field label="Client Email">
            <TextInput type="email" value={form.email} onChange={set('email')} placeholder="client@email.com" />
          </Field>
          <Field label="Tax Status">
            <SelectInput value={form.tax_status} onChange={set('tax_status')} options={TAX_STATUS_OPTIONS} />
          </Field>
          <Field label="Next Review Date">
            <TextInput type="date" value={form.next_review_date} onChange={set('next_review_date')} />
          </Field>
        </div>
      </div>

      {/* ── Section B: Objective & Investment Context ── */}
      <div className="cip-form-section">
        <SectionHeader num="B" title="Objective & Investment Context" />
        <div className="cip-form-grid">
          <Field label="Primary Objective">
            <SelectInput value={form.objective} onChange={set('objective')} options={OBJECTIVE_OPTIONS} />
          </Field>
          <Field label="Investment Horizon">
            <SelectInput value={form.horizon} onChange={set('horizon')} options={HORIZON_OPTIONS} />
          </Field>
          <Field label="Liquidity Requirement">
            <SelectInput value={form.liquidity_need} onChange={set('liquidity_need')} options={LIQUIDITY_OPTIONS} />
          </Field>
          <Field label="Income Requirement">
            <SelectInput value={form.income_requirement} onChange={set('income_requirement')} options={INCOME_OPTIONS} />
          </Field>
          <Field label="Ongoing SIP (₹/month)">
            <TextInput value={form.sip} onChange={set('sip')} placeholder="Optional" />
          </Field>
          <Field label="Source of Funds">
            <SelectInput value={form.source_of_funds} onChange={set('source_of_funds')} options={SOURCE_OPTIONS} />
          </Field>
        </div>

        <Field label="Existing Holdings to Consider" span2>
          <textarea
            className="cip-textarea"
            value={form.existing_holdings}
            onChange={e => set('existing_holdings')(e.target.value)}
            placeholder="Optional — e.g. ₹20L in PPF, existing equity MFs, PF corpus, real estate"
            rows={3}
          />
        </Field>

        {form.objective === 'Retirement planning' && (
          <div className="cip-info-note">
            Retirement-specific questions (age, retirement age, life expectancy, corpus targets) are
            captured in Retirement Planner, not here — that will be the natural next step once this
            profile is saved.
          </div>
        )}
      </div>

      {/* ── Duplicate warning ── */}
      {duplicateWarning && (
        <div className="cip-duplicate-warn">
          <div>
            <strong>A client named "{form.name.trim()}" already exists.</strong>
            {' '}Are you sure you want to create another? This may cause confusion.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn-outline" onClick={() => setDuplicateWarning(false)}>
              Cancel — go back
            </button>
            <button className="btn-primary" onClick={() => handleSaveAndContinue(true)}>
              Create anyway
            </button>
          </div>
        </div>
      )}

      {/* ── Nav buttons ── */}
      {!duplicateWarning && (
        <div className="cip-nav-buttons">
          <div />
          <button
            className="btn-primary"
            onClick={() => handleSaveAndContinue(false)}
            disabled={saving || !profileMode}
          >
            {saving ? 'Saving…' : 'Save & Continue →'}
          </button>
        </div>
      )}
    </div>
  );
}