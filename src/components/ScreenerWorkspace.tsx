import { InvestorProfilePanel } from './InvestorProfilePanel'
import { ScreenerTable } from './ScreenerTable'
import type {
  CompanyProfile,
  CountryLabel,
  EnrichedStock,
  InvestmentGoalId,
  RiskProfile,
  SortDirection,
  SortMetric,
  TrendLabel,
} from '../types/stock'

interface ScreenerWorkspaceProps {
  workspaceTab: 'screener' | 'profile'
  onWorkspaceTabChange: (tab: 'screener' | 'profile') => void

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

  displayStocks: EnrichedStock[]
  sortMetric: SortMetric
  sortDirection: SortDirection
  onSort: (metricId: SortMetric) => void
  screenerTableLoading: boolean
  error: string
  isFullMarketNonDb: boolean
  trendFilter: TrendLabel | 'all'
  countryFilter: CountryLabel | 'all'
  hasAnySortedStocks: boolean

  onOpenFundamentals: (symbol: string) => void
  onOpenTechnical: (symbol: string) => void
}

export function ScreenerWorkspace({
  workspaceTab,
  onWorkspaceTabChange,
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
  displayStocks,
  sortMetric,
  sortDirection,
  onSort,
  screenerTableLoading,
  error,
  isFullMarketNonDb,
  trendFilter,
  countryFilter,
  hasAnySortedStocks,
  onOpenFundamentals,
  onOpenTechnical,
}: ScreenerWorkspaceProps) {
  return (
    <section className="panel workspace-panel">
      <div className="workspace-tabs" role="tablist" aria-label="Workspace tabs">
        <button
          type="button"
          role="tab"
          aria-selected={workspaceTab === 'screener'}
          className={`workspace-tab ${workspaceTab === 'screener' ? 'active' : ''}`}
          onClick={() => onWorkspaceTabChange('screener')}
        >
          Market Results
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={workspaceTab === 'profile'}
          className={`workspace-tab ${workspaceTab === 'profile' ? 'active' : ''}`}
          onClick={() => onWorkspaceTabChange('profile')}
        >
          Investor Profile
        </button>
      </div>

      {workspaceTab === 'profile' ? (
        <InvestorProfilePanel
          riskTolerance={riskTolerance}
          onRiskToleranceChange={onRiskToleranceChange}
          investmentExperience={investmentExperience}
          onInvestmentExperienceChange={onInvestmentExperienceChange}
          investmentHorizon={investmentHorizon}
          onInvestmentHorizonChange={onInvestmentHorizonChange}
          investmentGoals={investmentGoals}
          onToggleGoal={onToggleGoal}
          riskProfile={riskProfile}
          profileLoading={profileLoading}
          recommendedStocks={recommendedStocks}
          companyProfiles={companyProfiles}
          onOpenFundamentals={onOpenFundamentals}
          onOpenTechnical={onOpenTechnical}
        />
      ) : (
        <ScreenerTable
          stocks={displayStocks}
          sortMetric={sortMetric}
          sortDirection={sortDirection}
          onSort={onSort}
          onOpenFundamentals={onOpenFundamentals}
          onOpenTechnical={onOpenTechnical}
          loading={screenerTableLoading}
          error={error}
          isFullMarketNonDb={isFullMarketNonDb}
          trendFilter={trendFilter}
          countryFilter={countryFilter}
          hasAnySortedStocks={hasAnySortedStocks}
        />
      )}
    </section>
  )
}
