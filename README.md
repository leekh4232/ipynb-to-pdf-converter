# Ipynb PDF Converter

VSCode 익스텐션으로 Jupyter Notebook (.ipynb) 및 Markdown (.md) 파일을 **PDF 문서**로 변환합니다.

아이티윌에서 진행되는 이광호 강사의 수업에서 활용될 목적으로 개발되었습니다.

## 기능

- 파일 탐색기 / 에디터 탭 / 명령 팔레트에서 .ipynb·.md 파일을 PDF로 변환
  - `Convert Notebook/Markdown to PDF` — 비밀번호 없이 변환 (환경설정에 기본 비밀번호가 있어도 적용하지 않음)
  - `Convert Notebook/Markdown to PDF (with Password)` — 환경설정의 기본 비밀번호로 암호화. 기본값이 비어 있으면 팝업으로 입력받음
- 일반 용지 규격으로 출력 (A3 · A4 · A5 · B4 · B5 · Letter · Legal · 16:9 와이드스크린, 세로/가로)
- 페이지 나누기: 글줄·표의 행·그림 중간에서 잘리지 않고, 두 번째 h1부터는 새 페이지에서 시작 (`nb_convert.py`와 동일)
- 머릿말·꼬릿말: 우측 상단에 파일명, 우측 하단에 `쪽 / 전체` 페이지 번호 (10 px 회색, 페이지 여백 띠 안에 배치)
- 문서가 참조하는 이미지(상대·절대 경로, `file:`·`http(s)` URL, 노트북 셀 첨부 `attachment:`)를 PDF에 포함. 찾지 못한 이미지는 출력 채널에 경고로 표시
- 페이지 테마 3종 (`nb_convert.py`의 `--theme`와 동일): `light`(기본값)·`dark`(Markdown Reader 팔레트), `default`(GitHub 문서 스타일)
  - `light`·`dark`는 `nb_convert.py`의 세로(A4) 출력과 같은 레이아웃: 줄 번호 없는 코드 박스, 왼쪽 강조선이 있는 출력 박스, 전체 폭 표, 가운데 정렬 그림, ANSI 색상 출력
- 코드 셀 신택스 하이라이트 테마 11종 — `mdr-dark`(기본값, `nb_convert.py --code-theme dark`)·`mdr-light`, Dracula, GitHub Light/Dark, Atom One Light/Dark, Monokai, Nord, VS Dark, Leekh
  - `Leekh`는 페이지 테마가 `default`일 때 제목·표·출력까지 A4 인쇄 스타일로 함께 꾸며줍니다
- **외부 런타임 의존성 없음** — Python, nbconvert, Playwright, 별도 Chromium 설치 불필요. VSCode 내장 Webview에서 직접 렌더링하고 캡처합니다.

## 사용 방법

1. VSCode에서 .ipynb 또는 .md 파일을 마우스 우클릭
2. `Convert Notebook/Markdown to PDF` 또는 `Convert Notebook/Markdown to PDF (with Password)` 선택
3. 같은 디렉토리에 `.pdf` 파일이 생성됨

## 환경설정

VSCode의 `settings.json`에서 다음과 같이 설정할 수 있습니다:

```json
{
  "ipynb-pdf-converter.pdfPageSize": "A4",
  "ipynb-pdf-converter.pdfPageOrientation": "portrait",
  "ipynb-pdf-converter.pdfPageMargin": 48,
  "ipynb-pdf-converter.deviceScaleFactor": 3,
  "ipynb-pdf-converter.pdfTheme": "light",
  "ipynb-pdf-converter.codeTheme": "mdr-dark",
  "ipynb-pdf-converter.pdfPassword": ""
}
```

- **ipynb-pdf-converter.pdfPageSize**: 용지 크기 (기본값: `A4`). `A3` · `A4` · `A5` · `B4`(JIS 257×364 mm) · `B5`(JIS 182×257 mm) · `Letter` · `Legal` · `Widescreen`(16:9 슬라이드, `nb_convert.py`의 가로 모드 — 가로 방향과 함께 사용)
  - 본문은 96 dpi 기준 CSS px로 배치됩니다 (A4 세로 ≈ 794 × 1123 px)
- **ipynb-pdf-converter.pdfPageOrientation**: 용지 방향 `portrait`(세로, 기본값) · `landscape`(가로)
- **ipynb-pdf-converter.pdfPageMargin**: 페이지 여백 (CSS px, 기본값: `48` = 0.5 in, `nb_convert.py`의 `@page` 여백)
  - `light`·`dark` 테마는 그 안쪽에 `nb_convert.py`의 본문 여백 30 px를 더합니다 (좌우는 모든 페이지, 위아래는 문서의 처음과 끝에만)
- **ipynb-pdf-converter.deviceScaleFactor**: 출력 배율 (1-5, 기본값: 3)
- **ipynb-pdf-converter.pdfTheme**: 페이지 테마 (기본값: `light`)
  - `light` / `dark`: Markdown Reader 팔레트 (`nb_convert.py --theme light|dark`와 동일). `dark`는 여백까지 어두운 종이색으로 출력
  - `default`: GitHub 문서 스타일 (github-markdown.css, 줄 번호 있는 코드 셀)
  - 코드 셀은 항상 `codeTheme`을 따르며, 마크다운 안의 코드 블록은 `codeTheme`의 밝기에 맞춰 light/dark 팔레트를 고릅니다
- **ipynb-pdf-converter.codeTheme**: 코드 셀 하이라이트 테마 (기본값: `mdr-dark`)
- **ipynb-pdf-converter.pdfPassword**: `(with Password)` 명령이 사용할 기본 비밀번호 (기본값: 빈 문자열 → 실행 때마다 팝업으로 입력)
  - 암호화된 PDF는 열람에 비밀번호가 필요하고, `nb_convert.py`와 같이 주석·양식 작성만 허용하고 인쇄·복사·편집은 막습니다
  - 비밀번호는 settings.json에 평문으로 저장됩니다. 암호화 방식은 jsPDF가 지원하는 40-bit RC4로, 가벼운 열람 제한 용도이지 강력한 보호 수단은 아닙니다

또는 VSCode 설정 UI에서 "Ipynb PDF Converter" 섹션을 찾아 직접 설정할 수 있습니다.

## 동작 원리

1. .ipynb 파일은 JSON으로 파싱, .md 파일은 본문 전체를 마크다운으로 처리
2. 마크다운은 `marked`, 코드 셀은 `highlight.js`로 HTML 생성
3. VSCode Webview (내장 Chromium)에 HTML 렌더링
4. `html2canvas`로 DOM을 캔버스에 그린 뒤, 글줄·표 행·그림을 가르지 않는 위치에서 페이지 단위로 분할
5. `jspdf`로 PDF를 조립(선택 시 비밀번호 암호화)하여 디스크에 저장

## 개발자

- **이광호** (leekh4232@gmail.com)

## 라이선스

MIT
