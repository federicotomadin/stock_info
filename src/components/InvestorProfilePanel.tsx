import { INVESTMENT_GOALS } from '../models/constants'
import { TickerActionsMenu } from './TickerActionsMenu'
import { cleanCompanyName, formatPercent, metricClass } from '../utils'
import { stockInsight } from '../riskProfile'
import type {
  CompanyProfile,
  EnrichedStock,
  InvestmentGoalId,
  RiskProfile,
} from '../types/stock'

interface InvestorProfilePanelProps {
  riskTolerance: 'low' | 'medium' | 'high'
  onRiskToleranceChange: (value: 'low' | 'medium' | 'high') => void
  investmentExperience: 'beginner' | 'intermediate' | 'advanced'
  onInvestmentExperienceChange: (value: 'beginner' | 'intermediate' | 'advanced') => void
  investmentHorizon: 'short' | 'medium' | 'long'
  onInvestmentHorizonChange: (value: 'short' | 'medium' | 'long') => void
  investmentGoals: InvestmentGoalId[]
  onToggleGoal: (goalId: InvestmentGoalId) => void
  riskProfile: RiskProfile
  profileLoading: boolean
  recommendedStocks: EnrichedStock[]
  companyProfiles: Record<string, CompanyProfile>
  onOpenFundamentals: (symbol: string) => void
  onOpenTechnical: (symbol: string) => void
}

export function InvestorProfilePanel({
  riskTolerance,
  onRiskToleranceChange,
  investmentExperience,
  onInvestmentExperienceChange,
  investmentHorizon,
  onInvestmentHorizonChange,
  investmentGoals,
  onToggleGoal,
  riskProfile,
  profileLoading,
  recommendedStocks,
  companyProfiles,
  onOpenFundamentals,
  onOpenTechnical,
}: InvestorProfilePanelProps) {
  return (
    <div className="profile-panel">
      <h2>Investor profile assistant</h2>
      <p className="subtitle">
        Answer a few questions and get stock ideas with a suggested horizon.
      </p>
      <div className="profile-grid">
        <fieldset>
          <legend>Risk tolerance</legend>
          <label>
            <input
              type="radio"
              name="risk-tolerance"
              checked={riskTolerance === 'low'}
              onChange={() => onRiskToleranceChange('low')}
            />
            Low
          </label>
          <label>
            <input
              type="radio"
              name="risk-tolerance"
              checked={riskTolerance === 'medium'}
              onChange={() => onRiskToleranceChange('medium')}
            />
            Medium
          </label>
          <label>
            <input
              type="radio"
              name="risk-tolerance"
              checked={riskTolerance === 'high'}
              onChange={() => onRiskToleranceChange('high')}
            />
            High
          </label>
        </fieldset>

        <fieldset>
          <legend>Experience</legend>
          <label>
            <input
              type="radio"
              name="experience"
              checked={investmentExperience === 'beginner'}
              onChange={() => onInvestmentExperienceChange('beginner')}
            />
            Beginner
          </label>
          <label>
            <input
              type="radio"
              name="experience"
              checked={investmentExperience === 'intermediate'}
              onChange={() => onInvestmentExperienceChange('intermediate')}
            />
            Intermediate
          </label>
          <label>
            <input
              type="radio"
              name="experience"
              checked={investmentExperience === 'advanced'}
              onChange={() => onInvestmentExperienceChange('advanced')}
            />
            Advanced
          </label>
        </fieldset>

        <fieldset>
          <legend>Preferred horizon</legend>
          <label>
            <input
              type="radio"
              name="preferred-horizon"
              checked={investmentHorizon === 'short'}
              onChange={() => onInvestmentHorizonChange('short')}
            />
            1-3 months
          </label>
          <label>
            <input
              type="radio"
              name="preferred-horizon"
              checked={investmentHorizon === 'medium'}
              onChange={() => onInvestmentHorizonChange('medium')}
            />
            3-12 months
          </label>
          <label>
            <input
              type="radio"
              name="preferred-horizon"
              checked={investmentHorizon === 'long'}
              onChange={() => onInvestmentHorizonChange('long')}
            />
            1+ years
          </label>
        </fieldset>

        <fieldset>
          <legend>Goals (multiple choice)</legend>
          {INVESTMENT_GOALS.map((goal) => (
            <label key={goal.id}>
              <input
                type="checkbox"
                checked={investmentGoals.includes(goal.id)}
                onChange={() => onToggleGoal(goal.id)}
              />
              {goal.label}
            </label>
          ))}
        </fieldset>
      </div>

      <div className="profile-badge">Estimated profile: {riskProfile}</div>

      {profileLoading ? (
        <p className="status loading">Loading company fundamentals for recommendations...</p>
      ) : null}

      {recommendedStocks.length ? (
        <div className="recommendations">
          {recommendedStocks.map((stock) => (
            <article key={`rec-${stock.symbol}`} className="recommendation-card">
              <div className="recommendation-content">
                <div className="recommendation-main">
                  <h3>
                    <TickerActionsMenu
                      symbol={stock.symbol}
                      className="ticker-link ticker-link-inline"
                      onOpenFundamentals={() => onOpenFundamentals(stock.symbol)}
                      onOpenTechnical={() => onOpenTechnical(stock.symbol)}
                    />{' '}
                    <small>{cleanCompanyName(stock.name) ?? 'N/A'}</small>
                  </h3>
                  <div className="rec-meta">
                    <span className="rec-meta-item">
                      Trend: <strong>{stock.trend.label}</strong>
                    </span>
                    <span className="rec-divider" />
                    <span className="rec-meta-item">
                      Country: <strong>{stock.country}</strong>
                    </span>
                    <span className="rec-divider" />
                    <span className="rec-meta-item">
                      Horizon: <strong>{stock.recommendedHorizon}</strong>
                    </span>
                    <span className="rec-divider" />
                    <span className={`rec-meta-item ${metricClass(stock.yearChange)}`}>
                      1Y: <strong>{formatPercent(stock.yearChange)}</strong>
                    </span>
                  </div>
                  {companyProfiles[stock.symbol] ? (
                    <div className="rec-meta" style={{ marginTop: '0.25rem' }}>
                      {companyProfiles[stock.symbol].dataSource ? (
                        <span className="source-badge">{companyProfiles[stock.symbol].dataSource}</span>
                      ) : null}
                      <span className="rec-meta-item">
                        Industry: <strong>{companyProfiles[stock.symbol].industry ?? 'Unknown'}</strong>
                      </span>
                      <span className="rec-divider" />
                      <span className="rec-meta-item">
                        Sector: <strong>{companyProfiles[stock.symbol].sector ?? 'Unknown'}</strong>
                      </span>
                      {companyProfiles[stock.symbol].yearsOperating ? (
                        <>
                          <span className="rec-divider" />
                          <span className="rec-meta-item">
                            Years: <strong>{companyProfiles[stock.symbol].yearsOperating}+</strong>
                          </span>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <p className="recommendation-note">
                  {stockInsight(stock, companyProfiles[stock.symbol])}
                </p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>No recommendations yet. Load stock data first.</p>
        </div>
      )}
    </div>
  )
}
