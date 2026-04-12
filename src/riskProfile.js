import {cleanCompanyName} from "./utlils.js";

export const shortSummary = (summary, maxLength = 220) => {
    if (!summary) {
        return null
    }

    const cleaned = summary.replace(/\s+/g, ' ').trim()
    if (cleaned.length <= maxLength) {
        return cleaned
    }

    return `${cleaned.slice(0, maxLength - 3)}...`
}


export const detectSectorHint = (stock) => {
    const text = `${stock.symbol ?? ''} ${stock.name ?? ''}`.toUpperCase()

    const has = (tokens) => tokens.some((token) => text.includes(token))

    if (
        has([
            'SEMI',
            'SEMICONDUCTOR',
            'MICRO',
            'CHIP',
            'NVIDIA',
            'AMD',
            'INTEL',
            'TSM',
            'QUALCOMM',
            'BROADCOM',
        ])
    ) {
        return {
            sector: 'Semiconductors',
            sentence:
                'It is exposed to semiconductor demand cycles, where execution and product timing can change momentum quickly.',
        }
    }

    if (
        has([
            'BANK',
            'FINANCIAL',
            'PAY',
            'PAYMENT',
            'CAPITAL',
            'CARD',
            'FINTECH',
            'INSURANCE',
            'BROKER',
            'MERCADOLIBRE',
            'NU HOLDINGS',
            'SOFI',
        ])
    ) {
        return {
            sector: 'Financials / Fintech',
            sentence:
                'It operates in financial services where rate cycles, credit quality, and transaction growth are key drivers.',
        }
    }

    if (
        has([
            'OIL',
            'GAS',
            'ENERGY',
            'PETROLEUM',
            'PIPELINE',
            'SOLAR',
            'POWER',
            'ELECTRIC',
            'RENEWABLE',
            'EXXON',
            'CHEVRON',
        ])
    ) {
        return {
            sector: 'Energy',
            sentence:
                'It is tied to commodity and energy-cycle dynamics, which can create strong trends but also sharp reversals.',
        }
    }

    if (
        has([
            'PHARMA',
            'THERAPEUT',
            'BIOTECH',
            'BIO',
            'HEALTH',
            'MEDICAL',
            'DIAGNOSTIC',
            'LAB',
            'PFIZER',
            'NOVARTIS',
            'MERCK',
        ])
    ) {
        return {
            sector: 'Healthcare',
            sentence:
                'It sits in healthcare, where pipeline execution, approvals, and reimbursement trends can materially impact valuation.',
        }
    }

    if (
        has([
            'SOFTWARE',
            'CLOUD',
            'DATA',
            'CYBER',
            'AI',
            'COMPUTING',
            'INTERNET',
            'PLATFORM',
            'SAAS',
            'MICROSOFT',
            'ALPHABET',
            'AMAZON',
        ])
    ) {
        return {
            sector: 'Technology / Software',
            sentence:
                'It has technology exposure where product velocity, platform adoption, and margin expansion are central to long-term upside.',
        }
    }

    if (
        has([
            'AUTO',
            'MOTOR',
            'AEROSPACE',
            'AIRLINES',
            'ALUMINUM',
            'STEEL',
            'MACHINERY',
            'LOGISTICS',
            'RAIL',
            'INDUSTRIAL',
        ])
    ) {
        return {
            sector: 'Industrials',
            sentence:
                'It belongs to an industrial value chain where demand, utilization, and cost control usually shape earnings quality.',
        }
    }

    if (
        has([
            'RETAIL',
            'CONSUMER',
            'FOOD',
            'BEVERAGE',
            'APPAREL',
            'HOTEL',
            'TRAVEL',
            'RESTAURANT',
            'E-COMMERCE',
        ])
    ) {
        return {
            sector: 'Consumer',
            sentence:
                'It is driven by consumer demand trends, pricing power, and operating efficiency through the cycle.',
        }
    }

    return {
        sector: 'Diversified business',
        sentence:
            'It has broad business exposure, so trend confirmation and risk controls are especially important before entry.',
    }
}

export const stockInsight = (stock, profile) => {
    const company = cleanCompanyName(stock.name) ?? stock.symbol
    const exchange = stock.exchange ?? 'N/A'
    const trend = stock.trend?.label ?? 'Neutral'

    if (profile) {
        const sector = profile.sector ?? 'Unknown sector'
        const industry = profile.industry ?? 'Unknown industry'
        const yearsText = profile.yearsOperating
            ? `${profile.yearsOperating}+ years of operations`
            : 'operating history not publicly clear'
        const yearsContext =
            profile.yearsSource === 'founded'
                ? ` (estimated from founding year ${profile.foundedYear})`
                : profile.yearsSource === 'listed'
                    ? ` (estimated from listing year ${profile.listedYear})`
                    : ''
        const summaryLine =
            shortSummary(profile.businessSummary) ??
            'Public business summary is currently limited from the selected data source.'

        return `${company} (${exchange}: ${stock.symbol}) operates in ${industry} within the ${sector} sector, with approximately ${yearsText}${yearsContext}. ${summaryLine} Current signal is ${trend.toLowerCase()}, with a suggested horizon of ${stock.recommendedHorizon}.`
    }

    const sectorHint = detectSectorHint(stock)
    return `${company} (${exchange}: ${stock.symbol}) is a real operating business in the ${sectorHint.sector} space. ${sectorHint.sentence} Current signal is ${trend.toLowerCase()}, with a suggested horizon of ${stock.recommendedHorizon}.`
}
