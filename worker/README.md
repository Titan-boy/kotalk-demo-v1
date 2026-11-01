# kotalk-judge — AI 판정·학습 기록 서버 (Cloudflare Worker)

KoTalk의 회화 답변을 Claude가 판정하고, 동의한 학습자의 연습 기록을 저장하는 작은 서버입니다.

```
브라우저(GitHub Pages) ──▶ 이 Worker ──▶ Claude API        (AI 판정)
                                    └─▶ Cloudflare D1     (학습 기록)
                       (API 키·내보내기 암호는 여기에만 있음)
```

- 공개 사이트에 API 키를 넣으면 누구나 볼 수 있으므로, 키는 이 Worker의 secret에만 둡니다.
- 사이트의 `config.js`에서 `apiBase`가 비어 있으면 AI 판정도 학습 기록도 꺼지고, 지금처럼 단말 안에서만 동작합니다.
- AI 연결이 실패해도 그 답변은 간이 판정으로 처리되므로 회화가 멈추지 않습니다. 기록 전송이 실패해도 연습은 계속됩니다.

## 설치 순서 (처음 한 번)

1. **Claude API 키 발급**: https://platform.claude.com 에서 API 키를 만들고, **월 사용 한도(spend limit)**를 꼭 설정합니다.
2. **Cloudflare 계정**: https://dash.cloudflare.com 에서 무료 계정을 만듭니다.
3. 이 폴더에서 아래 명령을 차례로 실행합니다(Node.js 22 이상).

```bash
cd worker
```

```bash
npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

교사용 CSV 내보내기 암호입니다. 길고 추측하기 어려운 문자열로 정하세요.

```bash
npx wrangler secret put EXPORT_KEY
```

학습 기록용 데이터베이스를 만듭니다. 출력된 `database_id`를 `wrangler.toml`의 `REPLACE_WITH_DATABASE_ID` 자리에 붙여 넣습니다.

```bash
npx wrangler d1 create kotalk-records
```

```bash
npx wrangler d1 migrations apply kotalk-records --remote
```

4. `wrangler.toml`의 `CLASS_CODES`에 수업·강좌별 클래스 코드를 적습니다. `:student`는 동북대 학생용, `:general`은 TOFA 일반 수강생용입니다.

```toml
CLASS_CODES = "TU-KR2026A:student,TOFA-K1:general"
```

```bash
npx wrangler deploy
```

5. `deploy`가 끝나면 `https://kotalk-judge.<계정명>.workers.dev` 같은 주소가 나옵니다. 저장소 루트 `config.js`의 `apiBase`에 넣습니다(끝의 `/`는 빼고).

```js
apiBase: "https://kotalk-judge.<계정명>.workers.dev",
```

6. `config.js`의 `consent`에서 【】 부분(관리자, 연락처, 보관 기간, 성적과의 관계, 연구 주제)을 모두 채운 뒤 main에 반영합니다. 동의문은 `docs/data-management-ja.md`(윤리 심사용 초안)와 내용을 맞추세요.
7. 휴대폰에서 사이트를 엽니다. 설정(⚙️) → 「AIへの接続を確認する」로 AI 연결을, 「学習記録の登録・変更」으로 등록 화면을 확인합니다.

학습 기록을 쓰지 않을 때는 `config.js`의 `records`를 `false`로 바꾸고, `wrangler.toml`의 `[[d1_databases]]` 블록을 지운 뒤 배포합니다.

## 학습 기록

### 등록 흐름
- 처음 회화를 시작할 때 등록 화면이 한 번 나옵니다. 「登録しないで使う」를 누르면 아무것도 저장되지 않습니다.
- 먼저 구분을 고릅니다: **東北大学の学生**(클래스 코드 + 학번) / **TOFA の受講生**(클래스 코드 + 닉네임 + 성별·연령대·학습 경력·거주 지역. 모두 「回答しない」 선택 가능).
- 구분마다 다른 일본어 동의문을 보여 주고, 「기록 저장 동의(필수)」와 「연구 이용 동의(선택)」를 따로 받습니다.
- 클래스 코드의 구분(학생/일반)은 서버가 정합니다. 학생용 코드로 일반 등록은 할 수 없습니다.
- 본인은 설정 → 学習記録에서 동의를 바꾸거나, 등록을 해제하고 기록을 전부 지울 수 있습니다.

### 저장 내용
- 답변 1회마다: 테마, 차례, 몇 번째 시도, 상대 대사, 학습자 답(문자 또는 음성 인식 결과. **녹음 음성은 저장하지 않음**), 판정(AI/간이), AI 조언, 고친 문장
- 회화 1회마다: 연습 시간, 주고받은 횟수, 통한 횟수, 끝까지 했는지
- AI 판정 때 Claude로 보내는 것은 답과 장면 정보뿐입니다. 학번·닉네임·속성은 보내지 않습니다.

### 교사용 CSV 내보내기
브라우저에서 아래 주소를 열면 CSV가 내려받아집니다(Excel에서 바로 열림). `<암호>`는 `EXPORT_KEY`입니다.

| 내용 | 주소 |
|---|---|
| 답변 기록 | `https://kotalk-judge.<계정명>.workers.dev/export?key=<암호>&class=TOFA-K1&table=replies` |
| 회화 기록 | `…&table=sessions` |
| 등록자 목록 | `…&table=learners` |
| **연구용**(연구 동의자만, 학번·닉네임을 가명 ID로 변환) | 위 주소 끝에 `&research=1` |

- 주소에 암호가 들어가므로 공유하지 마세요. 브라우저 방문 기록에도 남으니, 공용 PC에서는 쓰지 마세요.
- 시간은 UTC(일본 시간 −9시간)입니다.

### 보관 기간이 끝났을 때
클래스 단위로 지웁니다(예: `TU-KR2026A`).

```bash
npx wrangler d1 execute kotalk-records --remote --command "DELETE FROM replies WHERE device_token IN (SELECT device_token FROM learners WHERE class_code='TU-KR2026A'); DELETE FROM sessions WHERE device_token IN (SELECT device_token FROM learners WHERE class_code='TU-KR2026A'); DELETE FROM learners WHERE class_code='TU-KR2026A';"
```

## 판정 방식

`src/judge.js`의 프롬프트로 다음을 받습니다.

| 항목 | 내용 |
|---|---|
| `verdict` | `ok`(통함) / `almost`(뜻은 짐작되지만 장면에 안 맞음·필수 표현 없음) / `ng`(답이 아님) |
| `feedback_ja` | 일본어 1~2문장 조언(학습자가 일본인이므로 설명은 전부 일본어) |
| `corrected_ko` | 학습자의 뜻을 살려 고친 문장(띄어쓰기 수정 포함) |
| `better_ko` | 다른 자연스러운 표현 |

- 준비된 답과 내용이 달라도(영화 대신 쇼핑 등) 장면에 맞으면 `ok`입니다.
- 질문에 답하지 않은 답변(「뭐 해요?」에 「안녕하세요」)은 `ok`가 되지 않습니다. 이 부분이 기존 간이 판정의 한계였습니다.
- 녹음 답변은 브라우저 음성 인식으로 만든 문자를 판정하고, 오인식 가능성을 프롬프트에 알려 줍니다.

## 모델과 비용 (추정)

- 모델: `claude-haiku-5-5`, effort `low` (`src/judge.js`의 `MODEL`). 단가: 입력 $0.10 / 출력 $0.50 (100만 토큰당).
- 답변 1회: 입력 약 1,300토큰 + 출력 약 500토큰(판단 과정 포함, 넉넉하게 잡음) → **약 $0.0004 ≈ 0.06엔**.
- 20분 사용 = 답변 약 30회로 가정(답변 1회에 상대 음성·조언 읽기 포함 약 40초).

| 매일 20분 사용자 | 하루 | 한 달(30일) |
|---|---|---|
| 1명 | 약 1.8엔 | 약 54엔 |
| 10명 | 약 18엔 | 약 540엔 |
| 100명 | 약 180엔 | 약 5,400엔 |
| 1,000명 | 약 1,800엔 | 약 54,000엔 |

(1달러 = 150엔 기준. 답변을 더 자주 보내는 사용자(20분에 60회)라면 위 금액의 약 2배.)

- **실제 토큰 수는 측정해서 확인하세요.** Worker가 요청마다 사용 토큰을 로그에 남깁니다(답변 문장은 남기지 않음). `npx wrangler tail`로 보거나, Console의 사용량 화면에서 확인합니다.
- Cloudflare Workers 무료 플랜은 하루 10만 요청까지입니다. 1,000명 × 30회 = 하루 3만 요청이라 무료 범위 안입니다. 넘으면 유료 플랜(월 $5~)이 필요합니다.
- Haiku에는 거절 시 자동 대체 모델 기능이 없습니다. 거절되면 그 답변만 사이트의 간이 판정으로 처리됩니다.
- 판정 품질이 부족하면 `MODEL`을 `claude-sonnet-5-5`(약 20배) 또는 `claude-opus-5-5`(약 40배)로 바꿀 수 있습니다.

## 보안 주의

- `wrangler.toml`의 `ALLOWED_ORIGINS`에 있는 사이트에서 온 요청만 받습니다. 다만 Origin 헤더는 브라우저 밖에서 위조할 수 있으므로 **완전한 차단은 아닙니다.** 반드시 Console에서 사용 한도를 설정하고, 필요하면 Cloudflare의 Rate Limiting 규칙을 추가하세요.
- 요청 크기(8KB)와 각 항목 길이를 제한합니다.
- 학습자의 답변 문장(한국어)이 Claude API로 전송됩니다. 사이트 설정 화면에도 이 내용을 적어 두었습니다.

## 확인 스크립트

Claude API·Cloudflare에 접속하지 않고 요청 형태·CORS·입력 검사, 그리고 학습 기록의 등록·저장·삭제·CSV 내보내기를 확인합니다(Node.js 22 이상).

```bash
npm run check
```
