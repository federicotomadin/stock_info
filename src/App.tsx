import type { FormEvent } from 'react'
import './App.css'
import { AppFooter } from './components/Footer.tsx'
import { AppAlerts } from './components/AppAlerts'
import { DetailPageLayout } from './components/DetailPageLayout'
import { ScreenerControls } from './components/ScreenerControls'
import { ScreenerWorkspace } from './components/ScreenerWorkspace'
import { FundamentalsView } from './FundamentalsView'
import { TechnicalAnalysisView } from './TechnicalAnalysisView'
import { useUnsubscribeMessage } from './hooks/useUnsubscribeMessage'
import { useScreenerData } from './hooks/useScreenerData'
import { useRecommendationPool } from './hooks/useRecommendationPool'
import { useCompanyProfiles } from './hooks/useCompanyProfiles'
import { useRiskProfile, useRecommendedStocks } from './hooks/useInvestorProfile'
import { useSymbolViewNavigation } from './hooks/useSymbolViewNavigation'
import { useAppStatusFlags } from './hooks/useAppStatusFlags'
import { useScreenerUiState } from './hooks/useScreenerUiState'
import { useScreenerFilterHandlers } from './hooks/useScreenerFilterHandlers'
import type { InvestmentGoalId, SortMetric } from './types/stock'

function App() {
  const {
    symbolsInput,
    setSymbolsInput,
    stocks,
    setStocks,
    universeSearch,
    setUniverseSearch,
    currentPage,
    setCurrentPage,
    error,
    warning,
    setWarning,
    setError,
    universeProgress,
    setUniverseProgress,
    mode,
    setMode,
    sortMetric,
    setSortMetric,
    sortDirection,
    setSortDirection,
    trendFilter,
    setTrendFilter,
    countryFilter,
    setCountryFilter,
    riskTolerance,
    setRiskTolerance,
    investmentExperience,
    setInvestmentExperience,
    investmentHorizon,
    setInvestmentHorizon,
    investmentGoals,
    setInvestmentGoals,
    workspaceTab,
    setWorkspaceTab,
  } = useScreenerUiState()

  const unsubscribeMessage = useUnsubscribeMessage()

  const {
    universeLoading,
    universeError,
    loadUniverse,
    useDbScreener,
    dbConnectionError,
    screenerRows,
    screenerTotal,
    screenerFetchLoading,
    filteredUniverse,
    sortedStocks,
    countryFilteredStocks,
    displayStocks,
    totalPages,
    fullMarketLoading,
    loadUniverseStocks,
    manualStocksLoading,
    fetchManualStocks,
  } = useScreenerData({
    symbolsInput,
    stocks,
    setStocks,
    universeSearch,
    currentPage,
    setCurrentPage,
    setError,
    setWarning,
    setUniverseProgress,
    mode,
    sortMetric,
    sortDirection,
    trendFilter,
    countryFilter,
  })

  const recommendationPool = useRecommendationPool({ useDbScreener, screenerTotal })
  const riskProfile = useRiskProfile({
    riskTolerance,
    investmentExperience,
    investmentHorizon,
    investmentGoals,
  })
  const recommendedStocks = useRecommendedStocks({
    useDbScreener,
    recommendationPool,
    screenerRows,
    countryFilteredStocks,
    sortedStocks,
    riskProfile,
    investmentGoals,
    investmentHorizon,
  })
  const { companyProfiles, profileLoading } = useCompanyProfiles({ workspaceTab, recommendedStocks })
  const {
    fundamentalsSymbol,
    technicalSymbol,
    handleBackToScreener,
    openFundamentalsInNewTab,
    openTechnicalInNewTab,
  } = useSymbolViewNavigation()

  const { progressPercent, dbExpiryLabel, showDbExpiryAlert, fullMarketStocksLoading, screenerTableLoading } =
    useAppStatusFlags({
      mode,
      useDbScreener,
      manualStocksLoading,
      screenerFetchLoading,
      fullMarketLoading,
      screenerRowsLength: screenerRows.length,
      universeProgress,
    })

  const { onSortMetricChange, onToggleSortDirection, onTrendFilterChange, onCountryFilterChange } =
    useScreenerFilterHandlers({ setSortMetric, setSortDirection, setTrendFilter, setCountryFilter, setCurrentPage })

  function handleSort(metricId: SortMetric) {
    if (sortMetric === metricId) {
      setSortDirection((current) => (current === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortMetric(metricId)
      setSortDirection('desc')
    }
    setCurrentPage(1)
  }

  function toggleGoal(goalId: InvestmentGoalId) {
    setInvestmentGoals((current) => {
      if (current.includes(goalId)) {
        if (current.length === 1) {
          return current
        }
        return current.filter((goal) => goal !== goalId)
      }
      return [...current, goalId]
    })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void fetchManualStocks(symbolsInput, { fromSubmit: true })
  }

  function selectManualMode() {
    if (mode !== 'manual') {
      setSymbolsInput('')
    }
    setMode('manual')
  }

  if (technicalSymbol) {
    return (
      <DetailPageLayout title="Technical analysis" subtitle="Indicadores + lectura AI">
        <TechnicalAnalysisView symbol={technicalSymbol} onBackToScreener={handleBackToScreener} />
      </DetailPageLayout>
    )
  }

  if (fundamentalsSymbol) {
    return (
      <DetailPageLayout title="Fundamentals" subtitle="Financial Modeling Prep">
        <FundamentalsView symbol={fundamentalsSymbol} onBackToScreener={handleBackToScreener} />
      </DetailPageLayout>
    )
  }

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <h1>
            Stock Screener
            <span className="app-header-subtitle">Performance Dashboard</span>
          </h1>
        </div>
      </header>

      <main className="page">
        <AppAlerts
          unsubscribeMessage={unsubscribeMessage}
          dbConnectionError={dbConnectionError}
          showDbExpiryAlert={showDbExpiryAlert}
          dbExpiryLabel={dbExpiryLabel}
        />

        <ScreenerControls
          mode={mode}
          onSelectUniverseMode={() => setMode('universe')}
          onSelectManualMode={selectManualMode}
          universeSearch={universeSearch}
          onUniverseSearchChange={setUniverseSearch}
          filteredUniverseCount={filteredUniverse.length}
          universeLoading={universeLoading}
          onRefreshUniverse={() => void loadUniverse({ force: true })}
          currentPage={currentPage}
          totalPages={totalPages}
          screenerTotal={screenerTotal}
          useDbScreener={useDbScreener}
          onPrevPage={() => setCurrentPage(Math.max(1, currentPage - 1))}
          onNextPage={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
          symbolsInput={symbolsInput}
          onSymbolsInputChange={setSymbolsInput}
          manualStocksLoading={manualStocksLoading}
          onManualSubmit={handleSubmit}
          sortMetric={sortMetric}
          onSortMetricChange={onSortMetricChange}
          sortDirection={sortDirection}
          onToggleSortDirection={onToggleSortDirection}
          trendFilter={trendFilter}
          onTrendFilterChange={onTrendFilterChange}
          countryFilter={countryFilter}
          onCountryFilterChange={onCountryFilterChange}
          universeError={universeError}
          error={error}
          warning={warning}
          onRefreshWarningData={() => {
            localStorage.removeItem('market-snapshot')
            void loadUniverseStocks({ forceRefresh: true })
          }}
          fullMarketStocksLoading={fullMarketStocksLoading}
          universeProgress={universeProgress}
          progressPercent={progressPercent}
        />

        <ScreenerWorkspace
          workspaceTab={workspaceTab}
          onWorkspaceTabChange={setWorkspaceTab}
          riskTolerance={riskTolerance}
          onRiskToleranceChange={setRiskTolerance}
          investmentExperience={investmentExperience}
          onInvestmentExperienceChange={setInvestmentExperience}
          investmentHorizon={investmentHorizon}
          onInvestmentHorizonChange={setInvestmentHorizon}
          investmentGoals={investmentGoals}
          onToggleGoal={toggleGoal}
          riskProfile={riskProfile}
          profileLoading={profileLoading}
          recommendedStocks={recommendedStocks}
          companyProfiles={companyProfiles}
          displayStocks={displayStocks}
          sortMetric={sortMetric}
          sortDirection={sortDirection}
          onSort={handleSort}
          screenerTableLoading={screenerTableLoading}
          error={error}
          isFullMarketNonDb={mode === 'universe' && !useDbScreener && fullMarketStocksLoading}
          trendFilter={trendFilter}
          countryFilter={countryFilter}
          hasAnySortedStocks={sortedStocks.length > 0}
          onOpenFundamentals={openFundamentalsInNewTab}
          onOpenTechnical={openTechnicalInNewTab}
        />
      </main>
      <AppFooter />
    </>
  )
}

export default App
