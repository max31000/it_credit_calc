import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { startTransition } from 'react'
import { calculate, type MortgageParams, type CalculationResult } from '../lib/engine'
import type { MortgageFact } from '../lib/tracker'
import type { AccountSettings, MortgageDto } from '../api/types'
import type { MortgageModeParams } from '../lib/mortgageToParams'

/** Семь полей, которые живут в аккаунте (С3 спеки, §2.6 дизайна таймлайна), а не в сценарии калькулятора */
export const ACCOUNT_SETTING_KEYS = [
  'salary',
  'depositRate',
  'freeMonthly',
  'horizonYears',
  'keyRate',
  'bankDiscount',
  'startingSavings',
] as const

type AccountSettingKey = (typeof ACCOUNT_SETTING_KEYS)[number]

function isAccountSettingKey(key: string): key is AccountSettingKey {
  return (ACCOUNT_SETTING_KEYS as readonly string[]).includes(key)
}

/** Контекст режима ипотеки (§2.6 спеки continuous-simulation) — персистится; сама факт-фаза
 *  (`mortgageFact`) НЕ персистится и пересобирается из данных сервера при каждом входе на
 *  страницу калькулятора — иначе это второй источник истины, который может разойтись с трекером. */
export interface LinkedMortgage {
  id: number
  title: string
  /** YYYY-MM-DD — дата, на которую посчитан остаток */
  asOf: string
  /** Остаток долга трекера — для баннера */
  balance: number
  /** Фактический платёж трекера — для баннера */
  payment: number
  /** true — текущий платёж не покрывает проценты (переименованный смысл, см. §2.2 спеки) */
  termFallback: boolean
  /** Ставка на момент входа в режим ипотеки (из mortgageToParams, заполняется в
   *  enterMortgageMode) — для баннера, не завязана на текущее положение слайдера ставки.
   *  Опционально: undefined в персисте, сохранённом до добавления поля — тогда строку
   *  ставки в баннере не показываем. */
  rate?: number
  /** 'YYYY-MM-DD' — дата выдачи, для подписей оси таймлайна */
  startedOn?: string
  /** Исходная сумма кредита, ₽ — для баннера, пока факт грузится (§2.6 спеки) */
  principal?: number
  /** Уплачено процентов, ₽ — для баннера, пока факт грузится */
  paidInterest?: number
  /** Месяцев с выдачи — для баннера, пока факт грузится */
  elapsedMonths?: number
}

/** Собирает `LinkedMortgage` из ипотеки и результата `mortgageToParams` — один хелпер
 *  вместо трёх копий в `MortgagePage` / `MortgageCard` / `CalculatorPage`. */
export function linkFromMortgage(m: MortgageDto, mapped: MortgageModeParams): LinkedMortgage {
  return {
    id: m.id,
    title: m.title,
    asOf: mapped.state.asOf,
    balance: mapped.state.currentBalance,
    payment: mapped.state.currentPayment,
    termFallback: mapped.termFallback,
    startedOn: m.startedOn,
    principal: mapped.fact.principal,
    paidInterest: mapped.fact.history.paidInterest,
    elapsedMonths: mapped.fact.elapsedMonths,
  }
}

interface CalculatorState {
  /** Активные параметры: то, что видят слайдеры и движок */
  params: MortgageParams
  /** «Свои» параметры (С1). В режиме ипотеки сохраняются нетронутыми */
  ownParams: MortgageParams
  /** Тумблер сценария слёта. По умолчанию выключен — расчёт идёт по льготной ставке. */
  slipEnabled: boolean
  linkedMortgage: LinkedMortgage | null
  /** Полное фактическое прошлое ипотеки — вход движка. НЕ персистится: пересобирается из
   *  данных сервера при каждом входе на страницу (§2.6 спеки). null вне режима ипотеки
   *  или пока факт ещё не загружен (см. `factError`). */
  mortgageFact: MortgageFact | null
  /** Текст ошибки загрузки факта; null — ошибки нет. Пока не null (и mortgageFact === null),
   *  расчёт режима ипотеки недостоверен и на экран не выводится (§8.4 спеки). */
  factError: string | null
  result: CalculationResult
  setParam: <K extends keyof MortgageParams>(key: K, value: MortgageParams[K]) => void
  /** Один пересчёт движка на несколько полей сразу (нужен для relinkLoan) */
  setParams: (patch: Partial<MortgageParams>) => void
  setSlipEnabled: (value: boolean) => void
  /** Месяц слёта, который реально участвует в расчёте: 0, если тумблер выключен. */
  effectiveSlipMonth: () => number
  /** Вход/обновление режима ипотеки. Идемпотентна: повторный вызов с теми же данными — no-op по смыслу */
  enterMortgageMode: (link: LinkedMortgage, params: MortgageParams, fact: MortgageFact) => void
  /** Возврат к своим параметрам */
  exitMortgageMode: () => void
  /** Применить настройки аккаунта (С3), не вызывая обратного PUT */
  applyAccountSettings: (s: AccountSettings) => void
  /** Пометить, что факт не удалось загрузить (страница покажет алерт вместо графиков) */
  setFactError: (message: string | null) => void
}

const defaultParams: MortgageParams = {
  apartmentPrice: 7_000_000,
  downPayment: 1_470_000,
  itRate: 6,
  termYears: 20,
  freeMonthly: 100_000,
  depositRate: 16,
  horizonYears: 10,
  slipMonth: 36,
  keyRate: 16,
  bankDiscount: 0.5,
  salary: null,
  startingSavings: 0,
  usedPropertyBase: 0,
  usedInterestBase: 0,
}

/** Слёт уходит в движок только если тумблер включён — иначе params.slipMonth лишь «запомненная»
 *  позиция слайдера. Факт-фаза (§1 спеки continuous-simulation) передаётся движку как есть —
 *  стор её не трогает, только хранит и прокидывает. */
const recalc = (params: MortgageParams, slipEnabled: boolean, fact: MortgageFact | null): CalculationResult =>
  calculate({ ...params, slipMonth: slipEnabled ? params.slipMonth : 0 }, fact?.engine ?? null)

interface PersistedCalculatorState {
  params: MortgageParams
  ownParams: MortgageParams
  slipEnabled: boolean
  linkedMortgage: LinkedMortgage | null
}

export const useCalculatorStore = create<CalculatorState>()(
  persist(
    (set, get) => ({
      params: defaultParams,
      ownParams: defaultParams,
      slipEnabled: false,
      linkedMortgage: null,
      mortgageFact: null,
      factError: null,
      result: recalc(defaultParams, false, null),
      setParam: (key, value) => {
        const state = get()
        const newParams = { ...state.params, [key]: value }
        // Ключ аккаунта → пишем и в params, и в ownParams (это свойство пользователя,
        // а не сценария; правка в режиме ипотеки должна остаться и уехать на сервер).
        // Сценарный ключ → в ownParams, только если мы не в режиме ипотеки (§3.1).
        const patchOwn = isAccountSettingKey(key as string) || state.linkedMortgage === null
        const newOwnParams = patchOwn ? { ...state.ownParams, [key]: value } : state.ownParams
        set({ params: newParams, ownParams: newOwnParams })
        startTransition(() => {
          set({ result: recalc(newParams, get().slipEnabled, get().mortgageFact) })
        })
      },
      setParams: (patch) => {
        const state = get()
        const newParams = { ...state.params, ...patch }
        let newOwnParams = state.ownParams
        for (const key of Object.keys(patch) as Array<keyof MortgageParams>) {
          if (isAccountSettingKey(key as string) || state.linkedMortgage === null) {
            newOwnParams = { ...newOwnParams, [key]: patch[key] }
          }
        }
        set({ params: newParams, ownParams: newOwnParams })
        startTransition(() => {
          set({ result: recalc(newParams, get().slipEnabled, get().mortgageFact) })
        })
      },
      setSlipEnabled: (value) => {
        set({ slipEnabled: value })
        startTransition(() => {
          set({ result: recalc(get().params, value, get().mortgageFact) })
        })
      },
      effectiveSlipMonth: () => (get().slipEnabled ? get().params.slipMonth : 0),
      enterMortgageMode: (link, params, fact) => {
        const state = get()
        // slipMonth — не трогаем, остаётся из ownParams (слёт — гипотеза, а не факт).
        const finalParams = { ...params, slipMonth: state.ownParams.slipMonth }
        // rate — фиксируем ставку на момент входа (из mortgageToParams), а не читаем её
        // из params.itRate живьём в баннере: слайдер калькулятора мог её сдвинуть.
        const finalLink: LinkedMortgage = { ...link, rate: params.itRate }
        set({ linkedMortgage: finalLink, mortgageFact: fact, factError: null, params: finalParams, slipEnabled: false })
        startTransition(() => {
          set({ result: recalc(finalParams, false, fact) })
        })
      },
      exitMortgageMode: () => {
        const own = get().ownParams
        set({ linkedMortgage: null, mortgageFact: null, factError: null, params: own })
        startTransition(() => {
          set({ result: recalc(own, get().slipEnabled, null) })
        })
      },
      applyAccountSettings: (s) => {
        const state = get()
        const patch: Partial<MortgageParams> = {
          salary: s.salary,
          depositRate: s.depositRate,
          freeMonthly: s.freeMonthly,
          horizonYears: s.horizonYears,
          keyRate: s.keyRate,
          bankDiscount: s.bankDiscount,
          // Старая строка (версия 1 настроек) отдаёт undefined — трактуем как 0, не NaN.
          startingSavings: s.startingSavings ?? 0,
        }
        // Инвариант horizonYears ≤ termYears держим только для гостя: в режиме ипотеки
        // горизонт — это горизонт сравнения стратегий, а не срок кредита, кламп сроком
        // ипотеки уничтожал бы сравнение на коротких остатках (§7.4 спеки). ownParams
        // получает серверное значение как есть — сохраняем и не подменяем то, что реально
        // лежит в настройках аккаунта.
        const newParams = {
          ...state.params,
          ...patch,
          horizonYears: state.linkedMortgage === null ? Math.min(s.horizonYears, state.params.termYears) : s.horizonYears,
        }
        const newOwnParams = { ...state.ownParams, ...patch }
        set({ params: newParams, ownParams: newOwnParams })
        startTransition(() => {
          set({ result: recalc(newParams, get().slipEnabled, get().mortgageFact) })
        })
      },
      setFactError: (message) => set({ factError: message }),
    }),
    {
      name: 'mortgage-calculator-params',
      version: 5,
      partialize: (state) => ({
        params: state.params,
        ownParams: state.ownParams,
        slipEnabled: state.slipEnabled,
        linkedMortgage: state.linkedMortgage,
      }),
      migrate: (persisted, version): PersistedCalculatorState => {
        const prev = persisted as Partial<PersistedCalculatorState>
        // Старый персист (любая версия < 4) не содержит startingSavings/usedPropertyBase/
        // usedInterestBase — дозаливаем нулями (§2.6 дизайна таймлайна).
        const fillNewFields = (p: MortgageParams | undefined): MortgageParams => ({
          ...(p ?? defaultParams),
          startingSavings: p?.startingSavings ?? 0,
          usedPropertyBase: p?.usedPropertyBase ?? 0,
          usedInterestBase: p?.usedInterestBase ?? 0,
        })
        if (version < 3) {
          return {
            params: fillNewFields(prev.params),
            ownParams: fillNewFields(prev.params),
            // Старое сохранённое значение slipMonth (обычно дефолтные 36) — не осознанный
            // выбор пользователя, а дефолт слайдера. До v2 тумблера не было — выключаем.
            slipEnabled: version < 2 ? false : (prev.slipEnabled ?? false),
            linkedMortgage: null,
          }
        }
        if (version < 5) {
          // v3/v4 хранили в linkedMortgage поле `history: number[]` (компактный ряд остатков) —
          // фаза 6 удаляет его из контракта: единственный источник прошлого теперь
          // `mortgageFact`, который не персистится и перезапрашивается у сервера (§2.6 спеки).
          // Пересобираем LinkedMortgage только из полей, которые остались в типе.
          const oldLink = prev.linkedMortgage
          const linkedMortgage: LinkedMortgage | null = oldLink
            ? {
                id: oldLink.id,
                title: oldLink.title,
                asOf: oldLink.asOf,
                balance: oldLink.balance,
                payment: oldLink.payment,
                termFallback: oldLink.termFallback,
                rate: oldLink.rate,
                startedOn: oldLink.startedOn,
                // principal/paidInterest/elapsedMonths — новые поля §2.6, старый персист их не
                // содержит; страница calculator перезапросит факт и заполнит баннер актуальными числами.
              }
            : null
          return {
            params: fillNewFields(prev.params),
            ownParams: fillNewFields(prev.ownParams),
            slipEnabled: prev.slipEnabled ?? false,
            linkedMortgage,
          }
        }
        return {
          params: prev.params ?? defaultParams,
          ownParams: prev.ownParams ?? defaultParams,
          slipEnabled: prev.slipEnabled ?? false,
          linkedMortgage: prev.linkedMortgage ?? null,
        }
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Защита от неполных/устаревших данных: восстанавливаем дефолты для undefined полей
          state.params = { ...defaultParams, ...state.params }
          state.ownParams = { ...defaultParams, ...state.ownParams }
          state.slipEnabled = state.slipEnabled ?? false
          state.linkedMortgage = state.linkedMortgage ?? null
          // Факт-фаза никогда не персистится (§2.6 спеки) — страница калькулятора перезапросит
          // её у сервера; до этого гейт загрузки (linkedMortgage !== null && mortgageFact === null)
          // покажет скелетон вместо недостоверного расчёта.
          state.mortgageFact = null
          state.factError = null
          state.result = recalc(state.params, state.slipEnabled, null)
        }
      },
    }
  )
)
