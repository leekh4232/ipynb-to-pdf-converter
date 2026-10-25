# Ipynb PDF Converter

VSCode 익스텐션으로 Jupyter Notebook (.ipynb) 및 Markdown (.md) 파일을 **PDF 문서**로 변환합니다.

아이티윌에서 진행되는 이광호 강사의 수업에서 활용될 목적으로 개발되었습니다.

## 기능

- 파일 탐색기 · 에디터 탭 · 편집기 본문 우클릭 · 노트북 셀 우클릭 · 명령 팔레트에서 .ipynb·.md 파일을 PDF로 변환
  - `Convert Notebook/Markdown to PDF` — 비밀번호 없이 변환 (환경설정에 기본 비밀번호가 있어도 적용하지 않음)
  - `Convert Notebook/Markdown to PDF (with Password)` — 환경설정의 기본 비밀번호로 암호화. 기본값이 비어 있으면 팝업으로 입력받음
  - `teacherMode`를 켜면 `(hossam)` / `(jussam)` 변환(각각 비밀번호 유무)이 추가되어 강사 마크를 우측 상단에 넣음
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

1. VSCode에서 .ipynb 또는 .md 파일(탐색기·탭·편집기 본문·노트북 셀)을 마우스 우클릭
2. `Convert Notebook/Markdown to PDF` 또는 `Convert Notebook/Markdown to PDF (with Password)` 선택
3. 같은 디렉토리에 `.pdf` 파일이 생성됨. 같은 이름이 이미 있으면 `이름 (1).pdf`, `이름 (2).pdf`처럼 번호를 붙여 덮어쓰지 않음
4. 변환 중에는 VSCode 알림 영역에 진행률(렌더링 → 페이지 캡처 → PDF 조립 → 저장)이 표시되며 취소할 수 있음. 출력 창은 자동으로 열리지 않고, 오류나 이미지 누락 경고 알림의 "Show Log" 버튼으로 열 수 있음

## 환경설정

VSCode 설정 UI에서 "Ipynb PDF Converter" 섹션을 열면 아래 순서(중요도순)로 나옵니다. 설정 설명과 명령 이름은 VSCode 표시 언어가 한국어면 한글로, 그 외에는 영어로 보입니다. `settings.json` 예시:

```json
{
  "ipynb-pdf-converter.pdfTheme": "light",
  "ipynb-pdf-converter.codeTheme": "mdr-dark",
  "ipynb-pdf-converter.pdfPageSize": "A4",
  "ipynb-pdf-converter.pdfPageOrientation": "portrait",
  "ipynb-pdf-converter.pdfPageMargin": 48,
  "ipynb-pdf-converter.headerText": "{file}",
  "ipynb-pdf-converter.footerText": "{page} / {total}",
  "ipynb-pdf-converter.pdfPassword": ""
}
```

**모양**
- **pdfTheme**: 페이지 테마 (기본값 `light`). `light`/`dark`는 Markdown Reader 팔레트(`nb_convert.py --theme`와 동일, `dark`는 여백까지 어두움), `default`는 GitHub 문서 스타일. 코드 셀은 항상 `codeTheme`을 따름
- **codeTheme**: 코드 셀 하이라이트 테마 (기본값 `mdr-dark` = `nb_convert.py --code-theme dark`). `mdr-light`, Dracula, GitHub, Atom One, Monokai, Nord, VS Dark, Leekh(`default` 테마에서 제목·표까지 꾸밈)

**용지**
- **pdfPageSize**: `A3` · `A4`(기본값) · `A5` · `B4`(JIS 257×364 mm) · `B5`(JIS 182×257 mm) · `Letter` · `Legal` · `Widescreen`(16:9 슬라이드, 가로 방향과 함께)
- **pdfPageOrientation**: `portrait`(기본값) · `landscape`
- **pdfPageMargin**: 페이지 여백 (CSS px, 기본값 `48` = 0.5 in). `light`/`dark`는 그 안쪽에 본문 여백 30 px를 더함(좌우는 모든 페이지, 위아래는 문서 처음·끝)

**출력 파일**
- **outputDirectory**: 저장 폴더. 비우면 원본 옆, 상대 경로(`pdf`)는 원본 폴더 기준, 절대 경로 가능. 없으면 만듦
- **outputFileName**: 파일명 (기본값 `{name}`). `{name}` 원본 이름, `{date}` 날짜(YYYY-MM-DD)
- **openAfterConvert**: 변환 후 시스템 뷰어로 열기 (기본값 `false`)

**머릿말·꼬릿말** (페이지 여백 띠 안, 회색)
- **headerText** (기본값 `{file}`) · **footerText** (기본값 `{page} / {total}`): `{file}` `{date}` `{page}` `{total}` 사용 가능, 비우면 표시 안 함
- **headerAlign** · **footerAlign**: `left` · `center` · `right`(기본값)
- **headerFooterFontSize**: 글자 크기 (CSS px, 기본값 `10`)

**페이지 나누기**
- **pageBreakBefore**: `h1`(기본값, `nb_convert.py` 규칙) · `h1-h2` · `none`. 문서 맨 위의 제목은 빈 페이지를 만들지 않음. 글줄·표 행·그림은 어떤 설정에서도 잘리지 않음
- **breakBeforeTags**: 이 태그가 달린 셀부터 새 페이지 (예 `["pagebreak"]`)

**내용 선택** (노트북)
- **hideCodeCells**: 코드 셀 소스 숨김(출력은 유지) · **hideOutputs**: 모든 출력 숨김
- **excludeCellTags**: 이 태그가 달린 셀은 통째로 제외 (예 `["hide", "answer"]`) — 학생 배포본에서 정답 셀 빼기

**표·코드 모양**
- **tableNowrap**: `first`(기본값, 첫 열만 한 줄 = `nb_convert.py`) · `all`(모든 셀 한 줄, 넓은 표는 넘칠 수 있음) · `none`
- **showLineNumbers**: `auto`(기본값: `default` 테마만 표시) · `on` · `off`

**글꼴**
- **baseFontSize**: 루트 글자 크기 (CSS px, 기본값 `16`). 문서의 모든 크기가 이 값에 비례
- **bodyFontFamily** · **codeFontFamily**: CSS font-family 문자열. 비우면 테마 기본(본문 Helvetica Neue + Noto Sans CJK KR, 코드 Menlo)

**이미지 품질·파일 크기**
- **imageFormat**: `png`(기본값, 무손실) · `jpeg`(보통 1/4 이하 크기) · **jpegQuality**: 10-100 (기본값 `85`)
- **deviceScaleFactor**: 렌더링 배율 1-5 (기본값 `3`)

**보안** (`(with Password)` 명령에서만)
- **pdfPassword**: 기본 비밀번호. 비우면 실행 때마다 팝업. settings.json에 평문 저장되며 암호화는 40-bit RC4(jsPDF)로 가벼운 열람 제한용
- **pdfPermissions**: 열람자에게 허용할 작업 `print` · `copy` · `modify` · `annot-forms` (기본값 `["annot-forms"]` = `nb_convert.py`와 동일)
- **ownerPassword**: 소유자 비밀번호. 비우면 파일마다 무작위라 나중에 본인도 제한을 풀 수 없음

**표지·워터마크**
- **coverPage** (기본값 `false`) · **coverTitle** (`{file}`) · **coverSubtitle** · **coverAuthor**: 한 페이지 표지. `{file}` `{date}` 사용 가능
- **watermarkImage**: 첫 페이지 우측 상단에 고정할 이미지(원본 기준 상대 경로·절대 경로·URL, `nb_convert.py --ssam`에 해당) · **watermarkWidth**: 폭 (CSS px, 기본값 `100`)

**고급**
- **allowRemoteImages**: 문서가 참조하는 http(s) 이미지 내려받기 (기본값 `true`)
- **renderTimeoutSeconds**: 웹뷰 렌더링 제한 시간 (기본값 `60`, 긴 노트북이면 올리기)
- **teacherMode** (기본값 `false`): 켜면 우클릭 메뉴·명령 팔레트에 `(hossam)` · `(hossam, with Password)` · `(jussam)` · `(jussam, with Password)` 변환 명령이 추가됨. 이 모드는 `nb_convert.py --ssam`처럼 강사 마크(`https://data.hossam.kr/itwill-ho.png` / `itwill-ju.png`, 폭 100 px)를 모든 페이지 우측 상단 여백에 그리며, 이때 `headerText`는 표시하지 않음(꼬릿말은 유지)

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
