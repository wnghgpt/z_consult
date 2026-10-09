# 상담 데이터 흐름 문서

이 문서는 `z_consult`의 엑셀 업로드부터 Supabase 저장, 전체 자료 조회까지의 데이터 흐름을 정리한다.

## 1. 사용자 행동과 시스템 처리 분리형

EMR에서 추출한 원본 엑셀을 보존하면서 표준화하고, React 테이블에서 추가 정보를 입력한 뒤 다시 DB에 반영하는 업무 관점의 흐름이다.

```mermaid
flowchart TB
    subgraph USER[사용자가 하는 일]
        U1[EMR에서 엑셀 파일 드래그하여 추출]
        U2[줄이 깨진 원본 엑셀 업로드]
        U3[표준화된 상담 자료 확인]
        U4[React 테이블에서 추가 정보·사진 확인 및 입력]
        U5[저장 결과 확인]
    end

    subgraph SYSTEM[프로그램에서 일어나는 일]
        S1[원본 엑셀 파일과 추출 정보 수신]
        S2[줄바꿈·열 밀림·날짜 형식 복원]
        S3[고객·상담·수술/시술 데이터로 표준화]
        S4[원본 파일을 Supabase Storage에 저장]
        S5[등록일·등록번호·이름·추출일 기준 표준화 파일 생성]
        S6[원본·표준화 파일과 records를 Supabase DB에 저장]
        S7[기존 DB와 중복·변경 여부 비교]
        S8[환자·상담·수술/시술·사진을 React 테이블로 반환]
        S9[추가 정보와 사진 변경 내용을 DB에 반영]
    end

    U1 --> U2 --> S1 --> S2 --> S3 --> U3
    S3 --> S4 --> S5 --> S6 --> S7 --> S8 --> U4
    U4 --> S9 --> S8
    S8 --> U5

    classDef actualSave fill:#fff7ed,stroke:#f59e0b,stroke-width:3px,color:#7c2d12
    class S4,S6,S9 actualSave
```

## 2. 사진 자료 업무 흐름: 사용자 행동과 시스템 처리 분리형

EMR에서 캡처한 사진을 OneNote와 Word를 거쳐 OneDrive 및 Supabase Storage에 저장하고, React에서 미리보기하는 업무 흐름이다.

```mermaid
flowchart TB
    subgraph USER[사용자가 하는 일]
        U1[EMR에서 환자 사진 캡처]
        U2[OneNote에 환자별로 사진 정리]
        U3[주기적으로 Word 파일로 데이터 추출]
        U4[React에서 환자 사진 미리보기]
    end

    subgraph SYSTEM[프로그램에서 일어나는 일]
        S1[Word 파일 수집]
        S2[Word 문서에서 사진과 주변 텍스트 추출]
        S3[등록번호·이름·사진 순서 분석]
        S4{기존 사진과 비교}
        S5[새 사진만 추가 저장]
        S6[중복 사진은 건너뛰고 이력 기록]
        S7[OneDrive에 등록번호·이름별 폴더 생성 또는 사용]
        S8[OneDrive 폴더에 사진 저장]
        S9[Supabase Storage에서 등록번호 ID 기준으로 저장]
        S10[저장 경로와 환자·상담 연결정보를 DB에 기록]
        S11[Supabase Storage URL 조회]
    end

    U1 --> U2 --> U3 --> S1
    S1 --> S2 --> S3 --> S4
    S4 -->|신규 사진| S5
    S4 -->|기존과 동일| S6
    S5 --> S7 --> S8
    S5 --> S9
    S6 --> S10
    S8 --> S10
    S9 --> S10 --> S11 --> U4

    classDef actualSave fill:#fff7ed,stroke:#f59e0b,stroke-width:3px,color:#7c2d12
    class S6,S8,S9,S10 actualSave
```

### 사진 저장 기준

- OneDrive에는 `등록번호_이름` 기준의 환자별 폴더를 만든다.
- 같은 환자의 기존 사진은 유지하고, 새로 확인된 사진만 추가한다.
- 중복 여부는 파일 해시, 원본 파일명, 촬영일, 이미지 메타데이터 등을 조합해 판단한다.
- Supabase Storage에는 환자 등록번호 또는 내부 환자 ID를 기준으로 경로를 만든다.
- DB에는 Storage 경로, 원본 출처, 업로드 시각, 환자·상담 연결정보를 보관한다.
- React는 DB에 저장된 Storage 경로를 기준으로 접근 URL을 발급받아 미리보기한다.

## 3. 컴포넌트와 함수 호출 중심의 시퀀스

React 컴포넌트와 주요 함수가 실제로 호출되는 순서를 표현한다.

```mermaid
sequenceDiagram
    actor User as 사용자
    participant Main as main.jsx App
    participant Workbook as workbook.js
    participant Parser as parser.js
    participant Supabase as Supabase
    participant Cloud as CloudPanel.jsx
    participant Table as ConsultationTable.jsx

    User->>Main: XLSX 선택 또는 드롭
    Main->>Main: upload(file)
    Main->>Main: 확장자 / 용량 검증
    Main->>Main: file.arrayBuffer()
    Main->>Workbook: readWorkbook(buffer)
    Workbook->>Workbook: ExcelJS Workbook.load()
    Workbook->>Parser: parseRows(rows)
    Parser-->>Workbook: records, orphanRows
    Workbook-->>Main: sheets

    Main->>Supabase: list_consultation_rows()
    Supabase-->>Main: existingRows
    Main->>Main: buildReview(records, existingRows)
    Main-->>User: 업로드 검토 테이블 표시

    User->>Main: 적용 또는 제외 선택
    Main->>Cloud: reviewedSheet 전달
    User->>Cloud: DB 저장 클릭
    Cloud->>Cloud: stagingPayload()
    Cloud->>Supabase: stage_import(payload)
    Supabase-->>Cloud: importId
    Cloud->>Supabase: apply_import(importId)

    Supabase->>Supabase: patients upsert
    Supabase->>Supabase: consultations upsert
    Supabase->>Supabase: procedures upsert
    Supabase->>Supabase: imports 상태 갱신
    Supabase-->>Cloud: 저장 결과

    Cloud-->>Main: onSaved()
    Main->>Table: refreshKey 변경
    Table->>Supabase: list_consultation_rows()
    Supabase-->>Table: 상담 / 수술 자료
    Table-->>User: 전체 자료와 통계 표시
```

## 파일별 책임

| 파일 | 역할 |
| --- | --- |
| `src/main.jsx` | 업로드, 시트 선택, 기존 DB 비교, 검토 상태 관리 |
| `src/lib/workbook.js` | ExcelJS로 XLSX를 읽고 시트 단위 결과 생성 |
| `src/lib/parser.js` | 원본 행을 고객·상담·수술/시술 레코드로 복원 |
| `src/lib/staging.js` | 파일 해시, 연결 오류, Supabase staging payload 처리 |
| `src/features/CloudPanel.jsx` | 로그인, 권한 확인, 임시 적재, 본 DB 반영 |
| `src/features/ConsultationTable.jsx` | DB 조회, 검색, 필터, 상담·수술 통계 표시 |
| `supabase/migrations/*` | 테이블, RLS, `stage_import`, `apply_import`, 조회 RPC 정의 |

## 흐름을 읽는 기준

- `workbook.js`와 `parser.js`까지는 브라우저 메모리에서 처리된다.
- 파일을 선택하는 것만으로는 Supabase에 전송하지 않는다.
- 기존 DB 비교는 `list_consultation_rows` RPC로 수행한다.
- 사용자가 제외한 레코드는 `reviewedSheet.records`에서 제거된 후 저장된다.
- `stage_import`는 업로드 원본과 이력을 임시 적재한다.
- `apply_import`는 검토된 레코드를 `patients`, `consultations`, `procedures`에 upsert한다.
- 저장이 끝나면 `ConsultationTable`이 최신 자료를 다시 조회한다.

## 구현 계획

### 1. 업로드 화면 확장

XLSX·DOCX 파일 업로드와 파일 형식 검증

### 2. 엑셀 데이터 처리

줄 깨짐 복원, 표준화, 기존 DB 비교, 상담·수술 데이터 추출

### 3. Word 사진·메모 추출

등록번호·이름·시점·사진·특이사항 분석 및 환자별 연결

### 4. 원본 파일 저장

정상 파일만 원본 Word·Excel 파일과 업로드 이력 저장

### 5. 사진 Storage 저장

사진 파일명 생성, 중복 검사, Supabase Storage 업로드, 사진 메타데이터 저장

### 6. 메인 테이블 확장

사진 미리보기, 사진 개수, 실장 메모, 의사 상담 메모, 의사 수술 메모 표시

### 7. 메모·사진 수정 기능

메인 테이블에서 메모 입력, 사진 추가·제외, DB 재저장

### 8. 업로드 원본 이력 관리

파일명, 추출 기간, 업로드 시각, 처리 상태, 환자 수, 사진 수, 오류 수 표시

### 9. Supabase 권한·저장 RPC 구성

업로드·사진·메모 저장 RPC와 사용자별 접근 권한 적용

### 10. 검증 및 오류 처리

잘못된 파일 차단, 미연결 사진·중복·파싱 오류 표시, 재처리 지원
