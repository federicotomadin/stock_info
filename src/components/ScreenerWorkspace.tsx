import { InvestorProfilePanel } from './InvestorProfilePanel'
import { ScreenerTable } from './ScreenerTable'
import { AgentPanel } from './AgentPanel'
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
  workspaceTab: 'screener' | 'profile' | 'agent'
  onWorkspaceTabChange: (tab: 'screener' | 'profile' | 'agent') => void

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
  const showAgentTab = !import.meta.env.PROD
  const tab = showAgentTab ? workspaceTab : workspaceTab === 'agent' ? 'screener' : workspaceTab

  return (
    <section className="panel workspace-panel">
      <div className="workspace-tabs" role="tablist" aria-label="Workspace tabs">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'screener'}
          className={`workspace-tab ${tab === 'screener' ? 'active' : ''}`}
          onClick={() => onWorkspaceTabChange('screener')}
        >
          Market Results
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'profile'}
          className={`workspace-tab ${tab === 'profile' ? 'active' : ''}`}
          onClick={() => onWorkspaceTabChange('profile')}
        >
          Investor Profile
        </button>
        {showAgentTab ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'agent'}
            className={`workspace-tab ${tab === 'agent' ? 'active' : ''}`}
            onClick={() => onWorkspaceTabChange('agent')}
          >
            Paper agent
          </button>
        ) : null}
      </div>

      {tab === 'profile' ? (
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
      ) : tab === 'agent' ? (
        <AgentPanel />
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
