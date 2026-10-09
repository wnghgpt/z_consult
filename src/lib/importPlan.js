// Planning only: this module never writes or interprets unconfirmed date slots.
export const PLAN_LABELS = {
  review: '확인 필요', duplicate: '동일 자료 후보', update: '변경 후보',
  new_patient: '신규 고객 후보', new_visit: '신규 방문 후보',
};
const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value ?? null;
};
export function sourceSignature(record) {
  // Export order/row coordinates are not patient facts. Keep all meaningful fields.
  const fields = Object.fromEntries(Object.entries(record.fields ?? {}).filter(([key]) => !['번호','원본행','선택'].includes(key)));
  return JSON.stringify(stable({externalId: record.externalId, sourceVisitId: record.sourceVisitId, name: record.name, fields,
    notes: record.notes, content: record.content, consultation: record.consultation,
    procedures: record.procedures, procedureItems: record.procedureItems}));
}
export function consultationKey(record) {
  const c = record.consultation ?? {};
  return [record.externalId, c.date ?? c.date1 ?? '', c.item ?? ''].map(v => String(v ?? '').trim()).join('|');
}
export function planImport(records, baseline = null, options = {}) {
  const {identityConfirmed = false, baselineComplete = false} = options;
  const signatures = new Map(), incomingIds = new Map();
  for (const r of records) {
    const sig = sourceSignature(r); signatures.set(sig, (signatures.get(sig) ?? 0) + 1);
    if(r.externalId) incomingIds.set(r.externalId, (incomingIds.get(r.externalId) ?? 0) + 1);
  }
  return records.map(record => {
    const reasons = [], signature = sourceSignature(record);
    const sameBatch = signatures.get(signature) > 1;
    let action = 'review';
    if (sameBatch) reasons.push('이번 파일 안에 내용이 같은 블록이 반복됩니다. 방문 중복을 확정한 것은 아닙니다.');
    if (!baseline) reasons.push('비교 자료가 없습니다. DB의 신규 여부를 판단하지 않습니다.');
    else if (!identityConfirmed || !record.externalId) {
      reasons.push('원본 고객번호의 의미가 미확정이므로 고객·방문을 자동 연결하지 않습니다.');
      if (baseline.some(r => sourceSignature(r) === signature)) reasons.push('비교 자료에 동일한 내용이 있습니다.');
    } else {
      const matches = baseline.filter(r => r.externalId === record.externalId);
      if (matches.some(r => r.name !== record.name)) reasons.push('같은 고객번호에 다른 이름이 있습니다.');
      else if (matches.some(r => sourceSignature(r) === signature)) {
        action = 'duplicate'; reasons.push('고객번호와 복원 내용이 같습니다. 실제 방문 중복 여부는 별도 확인이 필요합니다.');
      } else if (!matches.length) {
        if (baselineComplete) {action = 'new_patient'; reasons.push('전체 비교 자료에 해당 고객번호가 없습니다.');}
        else reasons.push('부분 비교 자료에 없는 고객입니다. 신규 고객이라고 확정할 수 없습니다.');
      } else {
        const visitId = record.sourceVisitId;
        const consultKey = consultationKey(record);
        const visits = visitId ? matches.filter(r => r.sourceVisitId === visitId) : [];
        const sameConsultation = consultKey.replace(/\|/g,'') && matches.filter(r => consultationKey(r) === consultKey);
        if (visits.length === 1 && record.sourceUpdatedAt && visits[0].sourceUpdatedAt &&
          Number.isFinite(Date.parse(record.sourceUpdatedAt)) && Number.isFinite(Date.parse(visits[0].sourceUpdatedAt)) &&
          Date.parse(record.sourceUpdatedAt) > Date.parse(visits[0].sourceUpdatedAt)) {
          action = 'update'; reasons.push('같은 원본 방문번호이고 원본 수정 시점이 더 최신입니다.');
        } else if (visits.length === 1 && record.sourceUpdatedAt && visits[0].sourceUpdatedAt &&
          Number.isFinite(Date.parse(record.sourceUpdatedAt)) && Number.isFinite(Date.parse(visits[0].sourceUpdatedAt)) &&
          Date.parse(record.sourceUpdatedAt) <= Date.parse(visits[0].sourceUpdatedAt)) {
          reasons.push('같은 원본 방문번호이지만 비교 자료보다 최신이라고 볼 수 없습니다.');
        } else if (sameConsultation?.length) {
          action = sameConsultation.some(r => sourceSignature(r) === signature) ? 'duplicate' : 'update';
          reasons.push('고객번호·상담일·상담항목이 같아 같은 상담으로 봅니다.');
        } else if (visitId && !visits.length && baselineComplete && matches.every(r => r.sourceVisitId)) {
          action = 'new_visit'; reasons.push('전체 비교 자료에 없는 원본 방문번호입니다.');
        } else if (baselineComplete) {
          action = 'new_visit'; reasons.push('같은 고객이지만 상담일 또는 상담항목이 달라 별도 상담으로 봅니다.');
        } else reasons.push('부분 비교 자료에서는 같은 상담 여부를 확정하기 어렵습니다.');
      }
    }
    if ((record.issues?.length ?? 0) > 0) {
      reasons.push(...record.issues); action = 'review';
    }
    if (sameBatch || (record.externalId && incomingIds.get(record.externalId)>1)) {
      action = 'review'; reasons.push('동일 고객의 복수 블록은 개별 방문 확인이 필요합니다.');
    }
    return {key: record.key, action, reasons: [...new Set(reasons)], sameBatch};
  });
}
