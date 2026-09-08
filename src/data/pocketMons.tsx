/** 장소 유형 → 오리지널 Pocket Mon (닌텐도/포켓몬 IP 비사용) */
export type MonType = 'ember' | 'wave' | 'leaf' | 'stone' | 'spark' | 'taste' | 'sky'

export type PocketMon = {
  id: string
  name: string
  nameKo: string
  type: MonType
  typeKo: string
  cry: string
}

export function monTypeColor(t: MonType): string {
  const map: Record<MonType, string> = {
    ember: '#e85d4c',
    wave: '#3b9ad9',
    leaf: '#4caf6a',
    stone: '#9a8b78',
    spark: '#e8c547',
    taste: '#d4783a',
    sky: '#7eb6e8',
  }
  return map[t]
}

export function monTypeKo(t: MonType): string {
  const map: Record<MonType, string> = {
    ember: '불꽃',
    wave: '물결',
    leaf: '풀잎',
    stone: '바위',
    spark: '번개',
    taste: '맛',
    sky: '하늘',
  }
  return map[t]
}

function inferType(name: string, activity: string, eat?: boolean): MonType {
  const s = `${name} ${activity}`
  if (eat || /라멘|스시|모나|호토|맛집|식사|먹|카페|디저트|매차|우동/.test(s)) return 'taste'
  if (/온천|료칸|호텔|숙소|체크인/.test(s)) return 'ember'
  if (/절|신사|사원|궁|성/.test(s)) return 'stone'
  if (/공원|정원|숲|산|후지|등산/.test(s)) return 'leaf'
  if (/바다|강|수족관|해수욕|호수/.test(s)) return 'wave'
  if (/공항|역|전철|버스|케이블|로프웨이|이동|택시/.test(s)) return 'spark'
  if (/전망|타워|스카이|야경/.test(s)) return 'sky'
  return 'stone'
}

const NAME_POOL: Record<MonType, { en: string; ko: string; cry: string }[]> = {
  ember: [
    { en: 'Yukion', ko: '유키온', cry: '유키~!' },
    { en: 'Norumi', ko: '노루미', cry: '노루!' },
  ],
  wave: [
    { en: 'Mizuto', ko: '미즈토', cry: '미즈!' },
    { en: 'Suihan', ko: '스이한', cry: '수이~' },
  ],
  leaf: [
    { en: 'Momiji', ko: '모미지', cry: '모미!' },
    { en: 'Sakurao', ko: '사쿠라오', cry: '사쿠~' },
  ],
  stone: [
    { en: 'Toriiq', ko: '토리익', cry: '토리!' },
    { en: 'Ishimaru', ko: '이시마루', cry: '이시!' },
  ],
  spark: [
    { en: 'Densha', ko: '덴샤', cry: '덴!' },
    { en: 'Railbit', ko: '레일빗', cry: '레일!' },
  ],
  taste: [
    { en: 'Ramenbo', ko: '라멘보', cry: '멘멘!' },
    { en: 'Matchu', ko: '마츄', cry: '마차!' },
  ],
  sky: [
    { en: 'Sorabi', ko: '소라비', cry: '소라!' },
    { en: 'Yozora', ko: '요조라', cry: '요조!' },
  ],
}

export function monForPlace(
  placeId: string,
  name: string,
  activity: string,
  eat?: boolean,
): PocketMon {
  const type = inferType(name, activity, eat)
  const pool = NAME_POOL[type]
  let hash = 0
  for (let i = 0; i < placeId.length; i++) hash = (hash + placeId.charCodeAt(i) * (i + 3)) % 997
  const pick = pool[hash % pool.length]
  return {
    id: `mon-${placeId}`,
    name: pick.en,
    nameKo: pick.ko,
    type,
    typeKo: monTypeKo(type),
    cry: pick.cry,
  }
}

/** 간단한 얼굴 SVG — 타입별 색만 다름 */
export function MonFace({ type, caught }: { type: MonType; caught?: boolean }) {
  const c = monTypeColor(type)
  return (
    <svg viewBox="0 0 64 64" width="48" height="48" aria-hidden="true" className="mon-face">
      <circle cx="32" cy="34" r="22" fill={caught ? c : '#2a2a2a'} opacity={caught ? 1 : 0.35} />
      <circle cx="32" cy="34" r="22" fill="none" stroke={c} strokeWidth="3" strokeDasharray={caught ? '0' : '4 3'} />
      {caught ? (
        <>
          <circle cx="24" cy="30" r="3.5" fill="#111" />
          <circle cx="40" cy="30" r="3.5" fill="#111" />
          <path d="M24 42c4 5 12 5 16 0" fill="none" stroke="#111" strokeWidth="2.5" strokeLinecap="round" />
          <ellipse cx="18" cy="38" rx="5" ry="3" fill={c} opacity="0.45" />
          <ellipse cx="46" cy="38" rx="5" ry="3" fill={c} opacity="0.45" />
        </>
      ) : (
        <text x="32" y="40" textAnchor="middle" fontSize="22" fill={c}>
          ?
        </text>
      )}
    </svg>
  )
}
