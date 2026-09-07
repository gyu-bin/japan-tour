export type Place = {
  id: string
  name: string
  nameJp?: string
  /** 추천 방문 시각 (확정 예약과 구분) */
  time: string
  activity: string
  lat: number
  lng: number
  eat?: boolean
  stay?: boolean
  /** 공식 페이지 */
  officialUrl?: string
  /** 공식 기준 운영 안내 (변동 가능 — 방문 전 재확인) */
  hoursNote?: string
  /** 예약: recommended | confirmed | none */
  booking?: 'recommended' | 'confirmed' | 'none'
  bookingNote?: string
}

export type DayPlan = {
  id: string
  no: string
  date: string
  weekday: string
  title: string
  intro: string
  region: string
  /** 후지·산악 일정 — DEM 지형 표시 */
  terrain?: boolean
  places: Place[]
  transport: string
  food: string[]
  booking: string
  rainAlt: string
  links: { label: string; url: string }[]
}

export type TripMeta = {
  titleEn: string
  titleKo: string
  travelers: string
  period: string
  nights: string
  note: string
}
