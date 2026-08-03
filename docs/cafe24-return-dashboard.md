# 카페24 반품 사유를 STEP 1 대시보드에 반영하는 방법

이 문서는 카페24에서 내려받은 반품 CSV를 STEP 1 대시보드의 **부정 키워드**로 반영하고, GitHub Pages에 배포하는 반자동 운영 절차를 설명합니다.

## 데이터 흐름

```text
카페24 관리자에서 반품 CSV 다운로드
        ↓
로컬 변환기 실행
        ↓
개인정보 제거 · 제품/상태/사유/키워드 정리
        ↓
dashboard-prototype/data/cafe24-return-negative-keywords.json
        ↓
GitHub main 반영 → GitHub Pages 자동 배포
```

## 대시보드에 표시되는 정보

각 항목은 단순 범주가 아닌 사람이 바로 이해할 수 있는 문장형 키워드와 맥락으로 표시합니다.

- 키워드: 예) `생각보다 큼`
- 대상 상품: 예) `꼬모냉장고 홈바 크림 실속형`
- 반품 상태: 예) `반품완료`
- 사유 유형: 예) `단순변심`
- 상세 사유: 예) `사이즈가 생각보다 너무 커요`
- 건수

`주문실수`, `중복주문`처럼 제품 불만이 아닌 사유와 냉장고 본품이 아닌 액세서리 건은 대시보드 부정 키워드에서 제외합니다. 제외 기록은 로컬 처리 파일에만 남습니다.

## 개인정보 보호 원칙

- 카페24 원본 CSV는 `data/raw/`에만 보관하며 GitHub에 올리지 않습니다.
- 행 단위 처리 결과인 `data/processed/`도 GitHub에 올리지 않습니다.
- 공개되는 `dashboard-prototype/data/cafe24-return-negative-keywords.json`에는 제품명, 반품 상태, 사유 유형, 개인정보를 제거한 상세 사유, 집계 건수만 포함됩니다.
- 이메일, 전화번호, URL, 긴 숫자열은 변환 과정에서 제거합니다.

반품 사유에 고객 이름·주소처럼 식별 가능한 내용이 포함되었다면, 커밋 전에 공개 JSON의 상세 사유를 꼭 확인합니다.

## 처음 한 번 확인할 카페24 다운로드 양식

카페24 **주문관리 다운로드 양식관리**에 `STEP1반품분석용` 양식을 만들고 아래 항목을 포함합니다.

- 반품신청 구분, 반품신청 사유, 반품신청일
- 반품접수일, 반품접수거부 구분/사유/처리일
- 반품처리중 수거완료·환불보류·환불완료·환불전 처리일
- 반품철회 구분/사유/일
- 상품명(관리용), 주문상품명(옵션포함)
- 상품번호, 상품코드, 상품품목코드, 품목번호, 품목별 주문번호, 수량

고객명, 연락처, 주소, 결제정보는 넣지 않습니다.

## 매일 반자동 갱신하기

1. 카페24 관리자에서 반품 목록을 열고, 기간을 최근 하루 또는 필요한 기간으로 설정합니다.
2. `STEP1반품분석용` 양식으로 CSV를 다운로드합니다.
3. 프로젝트 폴더에서 아래 명령을 실행합니다. `다운로드파일.csv` 부분은 실제 파일 경로로 바꿉니다. 변환기는 파일을 `data/raw/cafe24_returns/`에 로컬 보관하고, 이전에 보관된 CSV와 합쳐 중복 없이 집계합니다.

```powershell
& "C:\Users\82108\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" `
  .\scripts\process_cafe24_returns.py `
  --file "C:\Users\82108\Downloads\다운로드파일.csv"
```

4. 생성된 공개 요약 파일을 확인합니다.

```text
dashboard-prototype/data/cafe24-return-negative-keywords.json
```

5. 변경 내용이 맞으면 다음 명령으로 GitHub에 반영합니다.

```powershell
git add dashboard-prototype/data/cafe24-return-negative-keywords.json
git commit -m "Update Cafe24 return dashboard data"
git push
```

새로운 반품 사유가 없다면 공개 요약 파일 내용도 바뀌지 않습니다. 원본 CSV는 로컬 보관용이므로 GitHub에 추가하지 않습니다.

## 키워드 규칙

변환기는 반품 상세 사유에서 다음처럼 구체적인 키워드를 만듭니다.

| 사유 예시 | 대시보드 키워드 |
| --- | --- |
| 사이즈가 생각보다 너무 커요 | 생각보다 큼 |
| 설치할 곳이 없어요, 공간이 부족해요 | 설치 공간 부족 |
| 생각보다 작아요 | 생각보다 작음 |
| 소리가 너무 커요 | 소음 |
| 냉장이 안 돼요 | 냉각 불량 |
| 파손·찌그러짐 | 파손 |
| 설명·사진과 달라요 | 상품 설명과 다름 |

키워드 규칙은 `scripts/process_cafe24_returns.py`의 `KEYWORD_RULES`에서 추가하거나 조정할 수 있습니다.

## GitHub Pages 배포

`main` 브랜치에 변경이 반영되면 `.github/workflows/deploy-pages.yml`이 자동으로 실행되어 GitHub Pages를 갱신합니다.

처음 한 번만 GitHub 저장소의 **Settings → Pages → Build and deployment → Source**를 `GitHub Actions`로 선택합니다. 이후 배포 주소는 해당 화면의 **Visit site**에서 확인할 수 있습니다.

이 프로젝트는 외부 시장 반응 API도 함께 사용합니다. 카페24 반품 키워드는 정적 JSON으로 제공하므로 GitHub Pages에서도 별도 API 키나 관리자 계정 없이 표시됩니다.
