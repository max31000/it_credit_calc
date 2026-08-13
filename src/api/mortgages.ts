import { apiClient } from './client'
import type {
  MortgageDto,
  MortgageDetails,
  MortgageEventDto,
  MortgageRequest,
  MortgageEventRequest,
} from './types'

/** §4.2 спеки — список отдаёт ипотеки вместе с их событиями (без этого нет
 *  верного состояния для карточки списка и режима ипотеки в калькуляторе). */
export const listMortgages = () => apiClient.get<MortgageDetails[]>('/mortgages')

export const getMortgage = (id: number) => apiClient.get<MortgageDetails>(`/mortgages/${id}`)

export const createMortgage = (data: MortgageRequest) =>
  apiClient.post<MortgageDto>('/mortgages', data)

export const updateMortgage = (id: number, data: MortgageRequest) =>
  apiClient.put<MortgageDto>(`/mortgages/${id}`, data)

export const deleteMortgage = (id: number) => apiClient.delete<void>(`/mortgages/${id}`)

export const listEvents = (mortgageId: number) =>
  apiClient.get<MortgageEventDto[]>(`/mortgages/${mortgageId}/events`)

export const createEvent = (mortgageId: number, data: MortgageEventRequest) =>
  apiClient.post<MortgageEventDto>(`/mortgages/${mortgageId}/events`, data)

export const deleteEvent = (mortgageId: number, eventId: number) =>
  apiClient.delete<void>(`/mortgages/${mortgageId}/events/${eventId}`)
