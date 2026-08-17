import { useEffect, useMemo, useRef, useState } from 'react'
import { apiEndpoint } from '../services/servicesAPI.ts'
import type { CompanyProfile, EnrichedStock } from '../types/stock'

interface UseCompanyProfilesParams {
  workspaceTab: 'screener' | 'profile'
  recommendedStocks: EnrichedStock[]
}

/** Fetches sector/industry/years-operating metadata for the current investor-profile picks. */
export function useCompanyProfiles({ workspaceTab, recommendedStocks }: UseCompanyProfilesParams) {
  const [fetchedProfiles, setFetchedProfiles] = useState<Record<string, CompanyProfile>>({})
  const [profileLoading, setProfileLoading] = useState(false)
  const requestIdRef = useRef(0)

  const symbols = useMemo(
    () => recommendedStocks.map((stock) => stock.symbol).filter(Boolean),
    [recommendedStocks]
  )

  useEffect(() => {
    if (workspaceTab !== 'profile' || !symbols.length) {
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    // Nested so the setState calls happen asynchronously relative to the effect's own execution.
    async function fetchProfiles() {
      setProfileLoading(true)

      const endpoint = apiEndpoint('/api/company-profiles')
      endpoint.searchParams.set('symbols', symbols.join(','))

      try {
        const response = await fetch(endpoint)
        const payload = await response.json()
        if (requestIdRef.current !== requestId) {
          return
        }

        const map: Record<string, CompanyProfile> = {}
        for (const item of (payload as { data?: CompanyProfile[] }).data ?? []) {
          map[item.symbol] = item
        }
        setFetchedProfiles(map)
      } catch {
        if (requestIdRef.current === requestId) {
          setFetchedProfiles({})
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setProfileLoading(false)
        }
      }
    }

    void fetchProfiles()
  }, [symbols, workspaceTab])

  // Not fetching (wrong tab or no picks yet) — don't surface stale data from a previous selection.
  const companyProfiles = workspaceTab === 'profile' && symbols.length ? fetchedProfiles : {}

  return { companyProfiles, profileLoading }
}
